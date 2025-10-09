.PHONY: all gatekeeper gate-front install clean run help

all: gatekeeper gate-front

gatekeeper:
	bun build --compile ./core/src/index.ts --outfile gatekeeper

gate-front:
	cd tui && go build -o gate-front

install: all
	mkdir -p ~/.local/bin
	cp ./tui/gate-front ~/.local/bin/
	cp ./gatekeeper ~/.local/bin/
	@echo "Installed gate-front and gatekeeper to ~/.local/bin"

clean:
	rm -f gatekeeper
	rm -f tui/gate-front

run: gate-front
	./tui/gate-front

run-gatekeeper: gatekeeper
	./gatekeeper

dev: gate-front
	./tui/gate-front

uninstall:
	rm -f ~/.local/bin/gate-front
	rm -f ~/.local/bin/gatekeeper
	@echo "Uninstalled gate-front and gatekeeper"

help:
	@echo "Available targets:"
	@echo "  all            - Build both gatekeeper and gate-front"
	@echo "  gatekeeper     - Build the TypeScript core"
	@echo "  gate-front     - Build the Go TUI"
	@echo "  install        - Install binaries to ~/.local/bin"
	@echo "  uninstall      - Remove installed binaries"
	@echo "  clean          - Remove build artifacts"
	@echo "  run            - Build and run gate-front"
	@echo "  run-gatekeeper - Build and run gatekeeper"
	@echo "  dev            - Build and run gate-front (alias)"
	@echo "  help           - Show this help message"
