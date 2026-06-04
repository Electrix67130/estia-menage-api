#!/bin/bash
# Lance uniquement le website (site vitrine, sans API), en tunnel externe.
# Wrapper : toute la logique est dans demo.sh.
exec "$(dirname "$0")/demo.sh" website
