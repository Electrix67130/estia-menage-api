#!/bin/bash
# Lance uniquement le dashboard + l'API, en tunnel externe.
# Wrapper : toute la logique est dans demo.sh.
exec "$(dirname "$0")/demo.sh" dashboard
