dev:
	python3 -m venv .venv
ifeq ($(OS), Windows_NT)
	.venv\Scripts\activate
else
	. .venv/bin/activate
endif
	pip3 install '.[dev]'

install:
	pip3 install .

fmt:
	yapf -pri .
	autoflake -ri .
	isort .

lint:
	pycodestyle .
	autoflake --check-diff --quiet --recursive .
