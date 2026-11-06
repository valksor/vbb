# Debugging And QA (fork)

## "Debugging And QA" opening list

- The Electron startup smoke runs the desktop app unpackaged with `BB_DESKTOP_HEADLESS=1`, which keeps all app windows hidden (native OS dialogs like About or microphone consent still appear); packaged launches ignore the variable.
