"""Tiny stand-in for the `flash_attn` package (not installable on this machine: no prebuilt Blackwell wheel).

UniRig only touches two entry points: `flash_attn.flash_attn_varlen_qkvpacked_func` (PTv3 serialized-patch attention)
and `flash_attn.modules.mha.MHA` (cross attention of the skinning model). Both are re-implemented here on top of
torch's scaled_dot_product_attention with identical parameter names, so the released checkpoints load unchanged.
Only ever put this directory on sys.path inside the rig runner (never globally).
"""
import torch
import torch.nn.functional as F


def flash_attn_varlen_qkvpacked_func(qkv, cu_seqlens, max_seqlen=None, dropout_p=0.0, softmax_scale=None, **_):
    """qkv: (total, 3, H, D); cu_seqlens: (n+1,) int32 -> (total, H, D). Each segment attends only to itself."""
    total, three, H, D = qkv.shape
    cu = cu_seqlens.tolist()
    lens = [cu[i + 1] - cu[i] for i in range(len(cu) - 1)]
    out = torch.empty((total, H, D), dtype=qkv.dtype, device=qkv.device)
    if len(set(lens)) == 1:
        n, L = len(lens), lens[0]
        x = qkv.view(n, L, 3, H, D).permute(2, 0, 3, 1, 4)  # 3, n, H, L, D
        o = F.scaled_dot_product_attention(x[0], x[1], x[2], dropout_p=dropout_p, scale=softmax_scale)
        return o.permute(0, 2, 1, 3).reshape(total, H, D)
    for i, L in enumerate(lens):
        if L == 0:
            continue
        x = qkv[cu[i]:cu[i + 1]].permute(1, 2, 0, 3)  # 3, H, L, D
        o = F.scaled_dot_product_attention(x[0][None], x[1][None], x[2][None], dropout_p=dropout_p, scale=softmax_scale)
        out[cu[i]:cu[i + 1]] = o[0].permute(1, 0, 2)
    return out
