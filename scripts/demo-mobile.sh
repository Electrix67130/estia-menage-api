#!/bin/bash
# Lance uniquement l'app mobile (Expo) + l'API, en tunnel externe.
# Wrapper : toute la logique est dans demo.sh.
exec "$(dirname "$0")/demo.sh" mobile
