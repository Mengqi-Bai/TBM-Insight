#!/bin/sh
set -eu
ssh-keygen -q -t ed25519 -N '' -f /etc/ssh/ssh_host_ed25519_key
install -d -m 700 -o tbm -g tbm /home/tbm/.ssh
install -m 600 -o tbm -g tbm /fixture-key.pub /home/tbm/.ssh/authorized_keys
install -d -m 700 -o tbm -g tbm /home/tbm/workspace
exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config
