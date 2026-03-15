.PHONY: ingress-up ingress-down ingress-status stacks test

ingress-up:
	./bin/ingressctl ingress up

ingress-down:
	./bin/ingressctl ingress down

ingress-status:
	./bin/ingressctl ingress status

stacks:
	./bin/ingressctl stack ls

test:
	npm test
