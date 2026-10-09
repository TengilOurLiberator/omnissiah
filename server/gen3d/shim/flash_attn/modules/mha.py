import torch
import torch.nn as nn
import torch.nn.functional as F


class MHA(nn.Module):
    """Cross/self attention with the same parameter names as flash_attn.modules.mha.MHA (Wq, Wkv / Wqkv, out_proj)."""

    def __init__(self, embed_dim, num_heads, num_heads_kv=None, cross_attn=False, qkv_proj_bias=True,
                 out_proj_bias=True, dropout=0.0, softmax_scale=None, causal=False, **_):
        super().__init__()
        self.embed_dim, self.cross_attn, self.causal = embed_dim, cross_attn, causal
        self.num_heads = num_heads
        self.num_heads_kv = num_heads_kv if num_heads_kv is not None else num_heads
        self.head_dim = embed_dim // num_heads
        self.softmax_scale = softmax_scale
        qkv_dim = self.head_dim * (self.num_heads + 2 * self.num_heads_kv)
        kv_dim = 2 * self.head_dim * self.num_heads_kv
        if not cross_attn:
            self.Wqkv = nn.Linear(embed_dim, qkv_dim, bias=qkv_proj_bias)
        else:
            self.Wq = nn.Linear(embed_dim, embed_dim, bias=qkv_proj_bias)
            self.Wkv = nn.Linear(embed_dim, kv_dim, bias=qkv_proj_bias)
        self.out_proj = nn.Linear(embed_dim, embed_dim, bias=out_proj_bias)

    def forward(self, x, x_kv=None, **_):
        B, S, _d = x.shape
        H, D = self.num_heads, self.head_dim
        if self.cross_attn:
            q = self.Wq(x).view(B, S, H, D)
            kv = self.Wkv(x if x_kv is None else x_kv)
            T = kv.shape[1]
            kv = kv.view(B, T, 2, self.num_heads_kv, D)
            k, v = kv[:, :, 0], kv[:, :, 1]
        else:
            qkv = self.Wqkv(x)
            q = qkv[..., :H * D].view(B, S, H, D)
            kv = qkv[..., H * D:].view(B, S, 2, self.num_heads_kv, D)
            k, v = kv[:, :, 0], kv[:, :, 1]
        o = F.scaled_dot_product_attention(q.transpose(1, 2), k.transpose(1, 2), v.transpose(1, 2),
                                           scale=self.softmax_scale, is_causal=self.causal)
        return self.out_proj(o.transpose(1, 2).reshape(B, S, H * D))
