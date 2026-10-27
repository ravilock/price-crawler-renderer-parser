.PHONY: test lint build image

test:
	npm install
	npm test

lint:
	npm install
	npm run lint

build:
	npm install
	npm run build

image:
	docker build -t renderer-parser:local .
