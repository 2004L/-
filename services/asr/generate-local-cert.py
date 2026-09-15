"""Generate a private, local-only CA and WSS certificate for the ASR service.

The output directory is intentionally outside the repository by default. The
CA certificate can be trusted by the current Windows user; the private key
must never be committed or uploaded.
"""

from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


def key_bytes(key: rsa.RSAPrivateKey) -> bytes:
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    )


def cert_bytes(cert: x509.Certificate) -> bytes:
    return cert.public_bytes(serialization.Encoding.PEM)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default=r"D:\AI-Hotel-Models\asr-certs")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    names = [output / "asr-local-ca.pem", output / "asr-local-cert.pem", output / "asr-local-key.pem"]
    if any(path.exists() for path in names) and not args.force:
        print(f"Certificates already exist in {output}; use --force to replace them.")
        return

    now = dt.datetime.now(dt.timezone.utc)
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Hotel Agent OS local ASR CA")])
    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(ca_name)
        .issuer_name(ca_name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=1))
        .not_valid_after(now + dt.timedelta(days=825))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(x509.KeyUsage(key_cert_sign=True, crl_sign=True, digital_signature=False, key_encipherment=False, content_commitment=False, data_encipherment=False, key_agreement=False, encipher_only=False, decipher_only=False), critical=True)
        .sign(ca_key, hashes.SHA256())
    )

    leaf_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    leaf_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Hotel Agent OS local ASR")])
    leaf_cert = (
        x509.CertificateBuilder()
        .subject_name(leaf_name)
        .issuer_name(ca_cert.subject)
        .public_key(leaf_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=1))
        .not_valid_after(now + dt.timedelta(days=398))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .sign(ca_key, hashes.SHA256())
    )

    (output / "asr-local-ca.pem").write_bytes(cert_bytes(ca_cert))
    (output / "asr-local-cert.pem").write_bytes(cert_bytes(leaf_cert) + cert_bytes(ca_cert))
    (output / "asr-local-key.pem").write_bytes(key_bytes(leaf_key))
    print(f"Generated local CA and WSS certificate in {output}")
    print(f"CA fingerprint: {ca_cert.fingerprint(hashes.SHA256()).hex()}")


if __name__ == "__main__":
    main()
