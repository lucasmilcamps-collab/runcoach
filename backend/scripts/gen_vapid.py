"""Generate a VAPID key pair for Web Push.

Run once:  python scripts/gen_vapid.py

Set VAPID_PRIVATE_KEY (printed below) as a backend env var. The public
applicationServerKey is derived from it at runtime, so it isn't stored — the
value is printed only so you can sanity-check it. Keep the private key secret.
"""

import base64

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid01


def main() -> None:
    vapid = Vapid01()
    vapid.generate_keys()

    der = vapid.private_key.private_bytes(
        serialization.Encoding.DER,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    private_b64 = base64.urlsafe_b64encode(der).rstrip(b"=").decode()

    raw_pub = vapid.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    public_b64 = base64.urlsafe_b64encode(raw_pub).rstrip(b"=").decode()

    print("VAPID_PRIVATE_KEY (secret — set as a backend env var):")
    print(private_b64)
    print()
    print("applicationServerKey (derived, for reference only):")
    print(public_b64)


if __name__ == "__main__":
    main()
