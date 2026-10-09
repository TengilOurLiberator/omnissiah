"""Game-asset baker: a trimmed fork of o_voxel.postprocess.to_glb (TRELLIS.2, MIT) with one fix.

The stock function samples the sparse attribute volume trilinearly; wherever a texel falls near the
edge of the sparse voxel set the missing neighbours count as zero, which shows up as dark / off-hue
blotches in the baked texture. Here a 'weight' channel (all ones) is interpolated alongside, the
colours are divided by it (normalised interpolation) and texels that are really outside the volume
are inpainted from their neighbours instead.

Run inside the trellis2 env only (needs cumesh, nvdiffrast, flex_gemm).
"""
import numpy as np
import torch
import cv2
from PIL import Image
import trimesh
import trimesh.visual
from flex_gemm.ops.grid_sample import grid_sample_3d
import nvdiffrast.torch as dr
import cumesh


def bake_mesh(vertices, faces, attr_volume, coords, attr_layout, aabb, voxel_size,
              decimation_target, texture_size, remesh=True, remesh_band=1, remesh_project=0, debug=None):
    """Returns (trimesh with UVs + RGBA base colour image + MR image, info dict)."""
    aabb = torch.tensor(np.array(aabb), dtype=torch.float32, device=coords.device)
    if isinstance(voxel_size, float):
        voxel_size = [voxel_size] * 3
    voxel_size = torch.tensor(np.array(voxel_size), dtype=torch.float32, device=coords.device)
    grid_size = ((aabb[1] - aabb[0]) / voxel_size).round().int()

    vertices = vertices.cuda()
    faces = faces.cuda()
    mesh = cumesh.CuMesh()
    mesh.init(vertices, faces)
    mesh.fill_holes(max_hole_perimeter=3e-2)
    vertices, faces = mesh.read()
    bvh = cumesh.cuBVH(vertices, faces)

    if not remesh:
        mesh.simplify(decimation_target * 3)
        mesh.remove_duplicate_faces()
        mesh.repair_non_manifold_edges()
        mesh.remove_small_connected_components(1e-5)
        mesh.fill_holes(max_hole_perimeter=3e-2)
        mesh.simplify(decimation_target)
        mesh.remove_duplicate_faces()
        mesh.repair_non_manifold_edges()
        mesh.remove_small_connected_components(1e-5)
        mesh.fill_holes(max_hole_perimeter=3e-2)
        mesh.unify_face_orientations()
    else:
        center = aabb.mean(dim=0)
        scale = (aabb[1] - aabb[0]).max().item()
        resolution = grid_size.max().item()
        mesh.init(*cumesh.remeshing.remesh_narrow_band_dc(
            vertices, faces, center=center,
            scale=(resolution + 3 * remesh_band) / resolution * scale,
            resolution=resolution, band=remesh_band, project_back=remesh_project,
            verbose=False, bvh=bvh))
        mesh.simplify(decimation_target)

    out_vertices, out_faces, out_uvs, out_vmaps = mesh.uv_unwrap(
        compute_charts_kwargs={
            "threshold_cone_half_angle_rad": np.radians(90.0),
            "refine_iterations": 0, "global_iterations": 1, "smooth_strength": 1,
        },
        return_vmaps=True, verbose=False)
    out_vertices, out_faces = out_vertices.cuda(), out_faces.cuda()
    out_uvs, out_vmaps = out_uvs.cuda(), out_vmaps.cuda()
    mesh.compute_vertex_normals()
    out_normals = mesh.read_vertex_normals()[out_vmaps]

    # ---- texel -> 3D position (rasterise in UV space)
    ctx = dr.RasterizeCudaContext()
    uvs_rast = torch.cat([out_uvs * 2 - 1, torch.zeros_like(out_uvs[:, :1]), torch.ones_like(out_uvs[:, :1])], -1).unsqueeze(0)
    rast = torch.zeros((1, texture_size, texture_size, 4), device="cuda", dtype=torch.float32)
    for i in range(0, out_faces.shape[0], 100000):
        rc, _ = dr.rasterize(ctx, uvs_rast, out_faces[i:i + 100000], resolution=[texture_size, texture_size])
        mc = rc[..., 3:4] > 0
        rc[..., 3:4] += i
        rast = torch.where(mc, rc, rast)
    mask = rast[0, ..., 3] > 0
    pos = dr.interpolate(out_vertices.unsqueeze(0), rast, out_faces)[0][0]
    valid_pos = pos[mask]
    _, face_id, uvw = bvh.unsigned_distance(valid_pos, return_uvw=True)
    tri = vertices[faces[face_id.long()]]
    valid_pos = (tri * uvw.unsqueeze(-1)).sum(dim=1)

    # ---- normalised trilinear sampling of the attribute volume
    C = attr_volume.shape[1]
    vol = torch.cat([attr_volume, torch.ones_like(attr_volume[:, :1])], 1)
    sampled = grid_sample_3d(
        vol, torch.cat([torch.zeros_like(coords[:, :1]), coords], -1),
        shape=torch.Size([1, C + 1, *grid_size.tolist()]),
        grid=((valid_pos - aabb[0]) / voxel_size).reshape(1, -1, 3), mode="trilinear")
    sampled = sampled.reshape(-1, C + 1)
    w = sampled[:, C:C + 1]
    norm = sampled[:, :C] / w.clamp(min=1e-3)
    attrs = torch.zeros(texture_size, texture_size, C, device="cuda")
    attrs[mask] = norm
    weight = torch.zeros(texture_size, texture_size, device="cuda")
    weight[mask] = w[:, 0]

    mask_np = mask.cpu().numpy()
    wt = weight.cpu().numpy()
    good = mask_np & (wt > 0.08)
    bad = (~good).astype(np.uint8)

    def chan(sl, r):
        a = np.clip(attrs[..., sl].cpu().numpy() * 255, 0, 255).astype(np.uint8)
        return cv2.inpaint(a, bad, r, cv2.INPAINT_TELEA)

    base_color = chan(attr_layout["base_color"], 3)
    metallic = chan(attr_layout["metallic"], 1)[..., None]
    roughness = chan(attr_layout["roughness"], 1)[..., None]

    info = dict(bad_texel_fraction=float(((~good) & mask_np).sum() / max(mask_np.sum(), 1)),
                texel_coverage=float(mask_np.mean()))
    if debug:
        Image.fromarray((np.clip(wt, 0, 1) * 255).astype(np.uint8)).save(debug + "_weight.png")
        Image.fromarray(base_color).save(debug + "_color.png")

    v_np = out_vertices.cpu().numpy()
    f_np = out_faces.cpu().numpy()
    uv_np = out_uvs.cpu().numpy()
    n_np = out_normals.cpu().numpy()
    # TRELLIS is Z-up; glTF is Y-up (+Z front).
    v_np[:, 1], v_np[:, 2] = v_np[:, 2].copy(), -v_np[:, 1].copy()
    n_np[:, 1], n_np[:, 2] = n_np[:, 2].copy(), -n_np[:, 1].copy()
    uv_np[:, 1] = 1 - uv_np[:, 1]

    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=Image.fromarray(np.concatenate([base_color, np.full_like(metallic, 255)], -1)),
        metallicRoughnessTexture=Image.fromarray(np.concatenate([np.zeros_like(metallic), roughness, metallic], -1)),
        metallicFactor=1.0, roughnessFactor=1.0, alphaMode="OPAQUE")
    tm = trimesh.Trimesh(vertices=v_np, faces=f_np, vertex_normals=n_np, process=False,
                         visual=trimesh.visual.TextureVisuals(uv=uv_np, material=material))
    return tm, info
