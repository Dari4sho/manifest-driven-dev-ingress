.PHONY: up down demo-up demo-down demo-check slug

up:
	../bin/ingressctl stack up --manifest ./project-local.json

down:
	../bin/ingressctl stack down --manifest ./project-local.json

demo-up:
	./scripts/dev-demo-parallel up

demo-down:
	./scripts/dev-demo-parallel down

demo-check:
	./scripts/dev-demo-parallel check

slug:
	../bin/ingressctl stack slug --manifest ./project-local.json
