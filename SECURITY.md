# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security vulnerability. Report it to
the project maintainer through the private security advisory mechanism on
GitHub, or contact the maintainer listed in the repository metadata with the
subject `Board Pinout security report`.

Include the affected version or commit, a description of the impact, steps to
reproduce, and a minimal proof of concept when safe. Please allow time for
triage and coordinated disclosure.

## Scope and safe use

Board Pinout parses YAML and renders data in documentation and in the browser.
Use the safe YAML loader and schema validation APIs; do not add unsafe Python
object deserialization. Treat board files and underlay paths as untrusted input,
escape values inserted into HTML, and keep generated output inside the intended
build directory.

The editor is a client-side authoring tool and does not upload documents to a
server. Review exported YAML before committing it to a downstream project.
