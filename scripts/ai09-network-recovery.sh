#!/bin/bash
# One-use DHCPv4 recovery for Issue #1798. No generic command or path input.
# /run configuration is ephemeral. networkctl reload reloads all network files.

ai09_validate_identity() {
    [[ $# == 12 && $1 == 0 && $2 == 848484 && $3 == /mnt/recover.sh &&
       $4 == /mnt && $5 == vfat && $6 == AI09SEED && $7 == CA77-6E6C &&
       $8 == 703b5247-01 && $9 == /dev/* && ${10} == /dev/* &&
       $9 != "${10}" && ${11} == 02ea2f0d324543a1ab2973e73c97421d &&
       ${12} == 00:15:5d:dc:2c:00 ]]
}

ai09_validate_interfaces() {
    [[ $# == 2 && $1 == /sys/class/net/eth0 && $2 == /sys/class/net/lo ]]
}

ai09_validate_original() {
    [[ $# == 2 && $1 == 0:0:644:95:1 &&
       $2 == ad37eaf039455b7f058d4da73c3fd008752787db45e952d343551d6f8b437fc9 ]]
}

ai09_validate_ipv4() {
    [[ $# == 1 && $1 =~ ^172\.29\.(8[0-9]|9[0-5])\.(0|[1-9][0-9]{0,2})/20$ ]] || return 1
    local octet=${1##*.}
    octet=${octet%/20}
    (( octet <= 255 )) || return 1
    [[ $1 != 172.29.80.0/20 && $1 != 172.29.80.1/20 && $1 != 172.29.95.255/20 ]]
}

ai09_render_network() {
    printf '%s\n' '[Match]' 'Name=eth0' 'MACAddress=00:15:5d:dc:2c:00' '' \
        '[Network]' 'DHCP=ipv4' 'IPv6AcceptRA=no' 'LinkLocalAddressing=no' '' \
        '[DHCPv4]' 'UseDNS=no' 'UseRoutes=no' 'UseNTP=no' 'UseHostname=no' 'SendHostname=no'
}

ai09_validate_selected_network() {
    [[ $# == 1 ]] || return 1
    local line count=0
    while IFS= read -r line; do
        if [[ $line =~ ^[[:space:]]*Network[[:space:]]File: ]]; then
            [[ $line =~ ^[[:space:]]*Network[[:space:]]File:[[:space:]]/run/systemd/network/09-ai09-bootstrap\.network$ ]] || return 1
            ((count+=1))
        fi
    done <<< "$1"
    [[ $count == 1 ]]
}

ai09_format_result() {
    [[ $# == 5 && $1 =~ ^(0|[1-9][0-9]{0,2})$ && $1 -le 255 &&
       $3 =~ ^[01]$ && $5 =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || return 1
    case "$2" in
        OPEN_EVIDENCE|PRESERVE_ORIGINAL|CREATE_CONFIG|RELOAD|RECONFIGURE|WAIT_DHCP|VERIFY_SELECTED_NETWORK|VERIFIED) ;;
        *) return 1 ;;
    esac
    [[ -z $4 ]] || ai09_validate_ipv4 "$4" || return 1
    local status=FAILED
    if [[ $1 == 0 ]]; then
        [[ $2 == VERIFIED && $3 == 1 ]] && ai09_validate_ipv4 "$4" || return 1
        status=DHCP_IPV4_VERIFIED
    fi
    printf '%s\n' 'RUN_ID=network-recovery-20261016-v1' \
        'SEED_RUN_ID=02ea2f0d324543a1ab2973e73c97421d' "TIMESTAMP=$5" \
        "STATUS=$status" "EXIT_CODE=$1" "PHASE=$2" "CONFIG_CREATED=$3" "IPV4=$4" \
        'ORIGINAL_SHA256=ad37eaf039455b7f058d4da73c3fd008752787db45e952d343551d6f8b437fc9'
}

ai09_hash_file() {
    local value
    value=$(sha256sum -- "$1") || return
    printf '%s\n' "${value%% *}"
}

ai09_require_directory() {
    [[ -d $1 && ! -L $1 && $(stat -c '%u:%g' -- "$1") == 0:0 ]] || return 1
    local mode
    mode=$(stat -c %a -- "$1") || return
    (( (8#$mode & 0022) == 0 ))
}

ai09_check_original() {
    [[ -f /run/systemd/network/10-ai09.network && ! -L /run/systemd/network/10-ai09.network ]] || return 1
    ai09_validate_original "$(stat -c '%u:%g:%a:%s:%h' -- /run/systemd/network/10-ai09.network)" \
        "$(ai09_hash_file /run/systemd/network/10-ai09.network)"
}

ai09_check_preserved_seed() {
    local names=(seed.id bridge.sh ai09-stdout.txt ai09-stderr.txt ai09-result.txt)
    local hashes=(
        aecb5d8ba490d9c58dc489a2a4d9527766a2d6a3ad4fe1a1c552eb3882abb34e
        0306204eb6d8dfdd8c659938a6c92373a8cd89b659017f269fbf6c34dee85a33
        cad77c296f367de9293aca445c3ee558a322c3f9f9229e3012cfaef4b938d7c7
        ed82bccdae44faa204c10944ed21e6b7ed0ca252830b6aeb297feee68123d596
        d8f02bbb50c19069b0ed691478d35e6c41e7f183e02f5b74cc45471db124c1f5
    )
    local index path size
    for index in "${!names[@]}"; do
        path=/mnt/${names[$index]}
        [[ -f $path && ! -L $path ]] || return 1
        size=$(stat -c %s -- "$path") || return
        (( size <= 1048576 )) || return 1
        [[ $(ai09_hash_file "$path") == "${hashes[$index]}" ]] || return 1
    done
}

ai09_check_nic() {
    ai09_validate_interfaces /sys/class/net/* || return 1
    [[ $(cat /sys/class/net/eth0/address) == 00:15:5d:dc:2c:00 ]]
}

ai09_require_no_global_ipv4() {
    local current
    current=$(ip -4 -o address show dev eth0 scope global) || return 23
    [[ -z $current ]] || return 23
}

ai09_require_no_default_route() {
    local current
    current=$(ip -4 route show default) || return 25
    [[ -z $current ]] || return 25
}

ai09_preflight() {
    local seed_device root_device path directory
    [[ $# == 0 && -d /mnt && ! -L /mnt && -f /mnt/recover.sh && ! -L /mnt/recover.sh ]] || return 21
    [[ $(stat -c %s -- /mnt/recover.sh) -le 65536 ]] || return 21
    seed_device=$(readlink -f -- "$(findmnt -rn -M /mnt -o SOURCE)") || return 21
    root_device=$(readlink -f -- "$(findmnt -rn -M / -o SOURCE)") || return 21
    [[ -b $seed_device && -b $root_device ]] || return 21
    ai09_validate_identity "$(id -u)" "$(hostname)" "$(readlink -f -- "${BASH_SOURCE[0]}")" \
        "$(findmnt -rn -M /mnt -o TARGET)" "$(findmnt -rn -M /mnt -o FSTYPE)" \
        "$(blkid -s LABEL -o value "$seed_device")" "$(blkid -s UUID -o value "$seed_device")" \
        "$(blkid -s PARTUUID -o value "$seed_device")" "$seed_device" "$root_device" \
        "$(cat /mnt/seed.id)" "$(cat /sys/class/net/eth0/address)" || return 21
    ai09_check_nic || return 21
    ai09_check_preserved_seed || return 21
    for directory in /run /run/systemd /run/systemd/network; do
        ai09_require_directory "$directory" || return 21
    done
    ai09_check_original || return 21
    for path in /mnt/recovery.id /mnt/recovery-stdout.txt /mnt/recovery-stderr.txt \
        /mnt/recovery-result.txt /mnt/recovery-original.network; do
        [[ ! -e $path && ! -L $path ]] || return 22
    done
    for directory in /etc/systemd/network /run/systemd/network /usr/lib/systemd/network /usr/local/lib/systemd/network; do
        if [[ -e $directory || -L $directory ]]; then
            ai09_require_directory "$directory" || return 21
        fi
        for path in "$directory/09-ai09-bootstrap.network" "$directory/09-ai09-bootstrap.network.d"; do
            [[ ! -e $path && ! -L $path ]] || return 22
        done
    done
    [[ $(timeout -k 1s 4s systemctl is-active systemd-networkd) == active ]] || return 23
    ai09_require_no_global_ipv4 || return 23
}

# This fixed subprocess only reads the exact NIC. The parent imposes a 45 s bound.
ai09_wait_dhcp() {
    local address
    while :; do
        ai09_check_nic || return 24
        address=$(ip -4 -o address show dev eth0 scope global | awk '{print $4}') || return
        if ai09_validate_ipv4 "$address"; then
            printf '%s\n' "$address"
            return 0
        fi
        sleep 1
    done
}

ai09_finish() {
    local rc=$? result
    trap - EXIT XFSZ
    set +e
    if ! timeout -k 1s 4s sync; then rc=74; fi
    result=$(ai09_format_result "$rc" "$phase" "$config_created" "$ipv4" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
    if [[ $? != 0 ]]; then
        rc=70
        result=$(ai09_format_result "$rc" "$phase" "$config_created" "" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
    fi
    printf '%s\n' "$result" >&3 || rc=74
    exec 3>&-
    # A failed final flush invalidates collection: console exit must match receipt.
    if ! timeout -k 1s 4s sync; then
        printf '%s\n' RECOVERY_RECEIPT_FLUSH_FAILED >&2
        rc=74
    fi
    exit "$rc"
}

ai09_main() {
    [[ $# == 0 ]] || return 64
    ai09_preflight || return
    umask 077
    set -o noclobber
    ulimit -f 1024
    phase=OPEN_EVIDENCE config_created=0 ipv4=''
    exec 3>/mnt/recovery-result.txt
    trap ai09_finish EXIT
    trap 'exit 153' XFSZ
    printf '%s\n' network-recovery-20261016-v1 >/mnt/recovery.id
    exec 1>/mnt/recovery-stdout.txt
    exec 2>/mnt/recovery-stderr.txt
    printf '%s\n' "GUEST_HOSTNAME=$(hostname)" 'INTERFACES=eth0,lo' 'RELOAD_SCOPE=GLOBAL'
    phase=PRESERVE_ORIGINAL
    cat /run/systemd/network/10-ai09.network >/mnt/recovery-original.network
    [[ $(ai09_hash_file /mnt/recovery-original.network) == ad37eaf039455b7f058d4da73c3fd008752787db45e952d343551d6f8b437fc9 ]]
    ai09_check_original
    phase=CREATE_CONFIG
    exec 4>/run/systemd/network/09-ai09-bootstrap.network
    config_created=1
    ai09_render_network >&4
    exec 4>&-
    chmod 0644 /run/systemd/network/09-ai09-bootstrap.network
    [[ $(ai09_hash_file /run/systemd/network/09-ai09-bootstrap.network) == "$(ai09_render_network | sha256sum | awk '{print $1}')" ]]
    ai09_check_nic
    ai09_check_original
    phase=RELOAD
    timeout -k 1s 9s networkctl reload
    phase=RECONFIGURE
    timeout -k 1s 9s networkctl reconfigure eth0
    phase=WAIT_DHCP
    ipv4=$(timeout -k 1s 44s /bin/bash /mnt/recover.sh --wait-dhcp)
    ai09_validate_ipv4 "$ipv4"
    printf 'IPV4=%s\n' "$ipv4"
    phase=VERIFY_SELECTED_NETWORK
    local status
    status=$(timeout -k 1s 9s networkctl --no-pager status eth0)
    printf '%s\n' "$status"
    ai09_validate_selected_network "$status"
    ip -4 route show
    ai09_require_no_default_route
    ai09_check_original
    ai09_check_preserved_seed
    phase=VERIFIED
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    set -euo pipefail
    PATH=/usr/sbin:/usr/bin:/sbin:/bin
    LC_ALL=C
    export PATH LC_ALL
    unset BASH_ENV ENV
    if [[ $# == 1 && $1 == --wait-dhcp ]]; then
        ai09_wait_dhcp
    else
        ai09_main "$@"
    fi
fi
