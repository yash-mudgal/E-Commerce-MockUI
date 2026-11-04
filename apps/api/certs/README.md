# Database CA certificates

`rds-global-bundle.pem` is Amazon RDS's public certificate bundle (root CAs for every region), from
https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem. It contains public certificates only, no keys.

The API image copies it to `/app/certs/`, and production sets `Database__RootCertificate=/app/certs/rds-global-bundle.pem`
with `Database__SslMode=VerifyFull`, so connections to RDS are encrypted and the server's identity is checked.
Refresh it when AWS publishes new CAs (see `docs/runbooks/rotate-secrets.md`).
