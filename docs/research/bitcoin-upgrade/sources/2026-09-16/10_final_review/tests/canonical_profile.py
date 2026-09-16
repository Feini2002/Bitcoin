"""Offline document-fixture canonicalization, not a deployed service or full RFC8785 implementation."""
import json, hashlib

def canonical_bytes(value):
    def check(v):
        if v is None or isinstance(v, (str, bool)):
            if isinstance(v, str): v.encode("utf-8", "strict")
            return
        if isinstance(v, int):
            if abs(v) > 9007199254740991: raise ValueError("unsafe integer; use a decimal string")
            return
        if isinstance(v, float): raise ValueError("floating JSON numbers are outside btc-ascii-key-json-v1")
        if isinstance(v, list):
            for x in v: check(x)
            return
        if isinstance(v, dict):
            for k, x in v.items():
                if not isinstance(k, str) or not k or any(ord(c)<32 or ord(c)>126 for c in k):
                    raise ValueError("keys must be nonempty printable ASCII")
                check(x)
            return
        raise ValueError("not a supported JSON value")
    check(value)
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")

def canonical_digest(value): return hashlib.sha256(canonical_bytes(value)).hexdigest()
