# System Health Check

A quick runbook to inspect system resources. Click **▶** on any block to execute.

---

## Disk Usage

Check disk space sorted by size (largest first).

```sh
df -h | sort -rh -k5
```

---

## Network Connectivity

Ping a public DNS server to test network reachability.

```sh
ping 8.8.8.8
```

---

## Network Interfaces

List active network interfaces and their IP addresses.

```sh
ifconfig | grep -E '^[a-z]|inet '
```

---

## Top Processes

Show the 10 most CPU-intensive processes.

```sh
ps aux | sort -rk3 | head -11
```

---

## System Uptime

Display uptime and current load averages.

```sh
uptime && echo "" && uname -a
```
