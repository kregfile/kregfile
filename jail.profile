name kregfile-jail

# will be invoked with private=
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
# too new
#rlimit-cpu 30
rlimit-nproc 75
nice 2
# too new
#timeout 00:01:00

quiet
