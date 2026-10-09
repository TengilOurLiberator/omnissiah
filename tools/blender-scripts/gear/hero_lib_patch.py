# patch Builder so mirrored (negative-determinant) primitives get their winding fixed
_orig_m = Builder._m
def _m2(self, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    m = _orig_m(self, loc, rot, scale)
    self._det = m.determinant()
    return m
Builder._m = _m2
_orig_add = Builder.add
def _add2(self, geom, color, emissive=False, xform=None):
    faces = [g for g in geom if isinstance(g, bmesh.types.BMFace)]
    if getattr(self, '_det', 1.0) < 0:
        bmesh.ops.reverse_faces(self.bm, faces=faces)
        self._det = 1.0
    return _orig_add(self, geom, color, emissive, xform)
Builder.add = _add2
