# Profile environment-name generator

This maintainer script refreshes profile-env-names.json from a selected Claude Code executable.

From this directory, run `node regenerate-profile-env-names.mjs /absolute/path/to/claude`.

If you omit the path, the script resolves claude from PATH. It reads the executable version and runs `strings -a` on that executable. It writes the reviewed environment-name fixture beside the script. Review the generated classifications and source metadata before committing the result.
