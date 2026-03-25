.PHONY: ingress-up ingress-down ingress-status dns-up dns-down dns-status dns-doctor dns-wsl-localfirst dns-win-sync dns-win-clear tls-init tls-refresh tls-trust tls-status tls-clean stacks test

ingress-up:
	./bin/ingressctl ingress up

ingress-down:
	./bin/ingressctl ingress down

ingress-status:
	./bin/ingressctl ingress status

dns-up:
	./bin/ingressctl dns up

dns-down:
	./bin/ingressctl dns down

dns-status:
	./bin/ingressctl dns status

dns-doctor:
	./bin/ingressctl dns doctor

dns-wsl-localfirst:
	sudo ./platform/wsl/resolv-prepend-localdns.sh

dns-win-sync:
	./platform/wsl/windows-hosts-sync.sh

dns-win-clear:
	./platform/wsl/windows-hosts-clear.sh

tls-init:
	./bin/ingressctl tls init

tls-refresh:
	./bin/ingressctl tls refresh

tls-trust:
	./bin/ingressctl tls trust

tls-status:
	./bin/ingressctl tls status

tls-clean:
	./bin/ingressctl tls clean

stacks:
	./bin/ingressctl stack ls

test:
	npm test
