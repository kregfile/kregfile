name kregfile-jail

# will be invoked with private=
private-etc empty
private-dev
private-tmp
read-only /

caps.drop all
seccomp
protocol unix,inet,inet6
nonewprivs

no3d

netfilter
net none

#rlimit-as 134217728
rlimit-cpu 30
rlimit-nproc 75
nice 2
timeout 00:01:00 

quiet
