package main

import (
	"fmt"
	"io"
	"time"
	"log"
	"os/exec"
	"strings"
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/glamour"
	"github.com/charmbracelet/bubbles/viewport"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

const header = `
 ██████╗  █████╗ ████████╗███████╗██╗  ██╗███████╗███████╗██████╗ ███████╗██████╗ 
██╔════╝ ██╔══██╗╚══██╔══╝██╔════╝██║ ██╔╝██╔════╝██╔════╝██╔══██╗██╔════╝██╔══██╗
██║  ███╗███████║   ██║   █████╗  █████╔╝ █████╗  █████╗  ██████╔╝█████╗  ██████╔╝
██║   ██║██╔══██║   ██║   ██╔══╝  ██╔═██╗ ██╔══╝  ██╔══╝  ██╔═══╝ ██╔══╝  ██╔══██╗
╚██████╔╝██║  ██║   ██║   ███████╗██║  ██╗███████╗███████╗██║     ███████╗██║  ██║
 ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚══════╝╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝
`

const (
	insertMode = iota
	normalMode
)

const gap = "\n\n"

type (
	errMsg error
)

type reqMsg struct {
	Query string `json:"query"`
}

type resMsg struct {
	Answer  string `json:"answer"`
	Success bool   `json:"success"`
}

func getMarkdownRenderer(width int) *glamour.TermRenderer {
	r, _ := glamour.NewTermRenderer(
		glamour.WithStylePath("dark"),
		glamour.WithWordWrap(width),
	)
	return r
}


func askLLM(query string) tea.Cmd {
	return func() tea.Msg {
		url := "http://localhost:6969/ask"

		reqBody := reqMsg{Query: query}
		jsonData, err := json.Marshal(reqBody)
		if err != nil {
			return errMsg(err)
		}
		client := &http.Client{Timeout: 30 * time.Second}
		req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
		if err != nil {
			return errMsg(err)
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return errMsg(err)
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return errMsg(err)
		}
		var response resMsg
		if err := json.Unmarshal(body, &response); err != nil {
			return errMsg(err)
		}
		return response
	}
}


//TODO: add support for sending files
func remindLLM(data string) tea.Cmd {
	return func() tea.Msg {
		url := "http://localhost:6969/remember"

		client := &http.Client{Timeout: 30 * time.Second}
		req, err := http.NewRequest("POST", url, bytes.NewBuffer([]byte(data)))
		if err != nil {
			return errMsg(err)
		}
		req.Header.Set("Content-Type", "text/plain")
		resp, err := client.Do(req)
		if err != nil {
			return errMsg(err)
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return errMsg(err)
		}
		var response resMsg
		if err := json.Unmarshal(body, &response); err != nil {
			return errMsg(err)
		}
		return response
	}
}

type command struct {
	name string
	help string
	fn   func (m *model, s string) (tea.Model, tea.Cmd)
}

type keybind struct {
	name string
	desc string
	action func(m *model) (tea.Model, tea.Cmd)
}
func ctrlcAction(m *model) (tea.Model, tea.Cmd) {
	fmt.Println(m.textarea.Value())
	return m, tea.Quit
}

func escAction(m *model) (tea.Model, tea.Cmd) {
	if m.mode == insertMode {
		m.textarea.Prompt = "normal "
		m.textarea.Placeholder = "press i to enter insert mode"
		m.mode = normalMode
		return m, nil
	}
	return m, nil
}

func iAction(m *model) (tea.Model, tea.Cmd) {
	if m.mode == normalMode {
		m.textarea.Prompt = "> "
		m.textarea.Placeholder = "/help for more info"
		m.mode = insertMode
		return m, textarea.Blink
	}
	return m, nil
}

func enterAction(m *model) (tea.Model, tea.Cmd) {
	if m.waiting {
		return m, nil
	}
	query := m.textarea.Value()
	if strings.HasPrefix(query,"/") {
		if len(query[1:]) < 1 {
			return helpCommand(m, "prefix should be followed by a command")
		}
		cmds := strings.Split(query[1:], " ")
		cmdName := cmds[0]
		for _, cmd := range m.commands {
			if cmdName == cmd.name {
				if len(cmds) > 1 {
					return cmd.fn(m, strings.Join(cmds[1:], " "))
				}
				return cmd.fn(m, "")
			}
		}
		return helpCommand(m, fmt.Sprintf("unknown command: %s", cmdName))
	} else {
		return askCommand(m, query) 
	}
}

func helpCommand(m *model, msg string) (tea.Model, tea.Cmd) {
	nameStyle := lipgloss.NewStyle().Width(15).Align(lipgloss.Left)
	help := ""
	if len(msg) > 0 {
		help = "Error: " + msg
	}
	help += `
	=================GATEKEEPER=====================
	A RAG for your own personal knowledge base

	Commands:
	`
	for _, cmd := range m.commands {
		help += fmt.Sprintf("\t/%s\t%s\n\t", nameStyle.Render(cmd.name), cmd.help)
	}
	help += `
	Keybinds:
	`
	for _, keybind := range m.keybinds {
		help += fmt.Sprintf("\t%s\t%s\n\t", nameStyle.Render(keybind.name), keybind.desc)
	}
	help += `
	Modes:
	`
	help += fmt.Sprintf("\t%s\t%s\n\t", nameStyle.Render("normal"), "this allows you to scroll the text using vim motions")
	help += fmt.Sprintf("\t%s\t%s\n\t", nameStyle.Render("command"), "this allows you to enter commands see /help for more detail")
	help += fmt.Sprintf("\t%s\t%s\n\t", nameStyle.Render("insert"), "this allows you to type queries for the LLM and commands to the LLM")
	styledHelp := lipgloss.NewStyle().Foreground(lipgloss.Color("#e0e0e0")).Render(help)
	m.messages = append(m.messages, m.botStyle.Render("Bot: ")+styledHelp)
	m.viewport.SetContent(lipgloss.NewStyle().Width(m.viewport.Width).Render(strings.Join(m.messages, "\n")))
	m.textarea.Reset()
	m.viewport.GotoBottom()
	return m, nil
}

func quitCommand(m *model, _ string) (tea.Model, tea.Cmd) {
	return m, tea.Quit
}

func clearCommand(m *model, _ string) (tea.Model, tea.Cmd) {
	m.textarea.Reset()
	m.messages = []string{}
	m.viewport.SetContent("")
	m.viewport.GotoBottom()
	return m, nil
}

func askCommand(m *model, query string) (tea.Model, tea.Cmd) {
	queryStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#e0e0e0"))
	m.messages = append(m.messages, m.senderStyle.Render("You: ")+queryStyle.Render(query))
	m.messages = append(m.messages, m.spinner.View()+" Searching knowledgebase...")
	m.viewport.SetContent(lipgloss.NewStyle().Width(m.viewport.Width).Render(strings.Join(m.messages, "\n")))
	m.textarea.Reset()
	m.viewport.GotoBottom()
	m.waiting = true
	return m, tea.Batch(askLLM(query), m.spinner.Tick)
}

//TODO: implement this
func rememberCommand(m *model, data string) (tea.Model, tea.Cmd) {
	queryStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#e0e0e0"))
	m.messages = append(m.messages, m.senderStyle.Render("You: ")+queryStyle.Render("remember " + data))
	m.messages = append(m.messages, m.spinner.View()+" Indexing knowledgebase...")
	m.viewport.SetContent(lipgloss.NewStyle().Width(m.viewport.Width).Render(strings.Join(m.messages, "\n")))
	m.textarea.Reset()
	m.viewport.GotoBottom()
	m.waiting = true
	return m, tea.Batch(remindLLM(data), m.spinner.Tick)
}

type model struct {
	viewport    viewport.Model
	spinner     spinner.Model
	messages    []string
	commands    []command
	keybinds    []keybind
	textarea    textarea.Model
	senderStyle lipgloss.Style
	botStyle lipgloss.Style
	header      string
	waiting     bool
	mode		int
	err         error
}

func initialModel() model {
	ta := textarea.New()
	ta.Placeholder = "/help for more info"
	ta.Focus()

	ta.Prompt = "> "
	ta.CharLimit = 280

	ta.SetWidth(30)
	ta.SetHeight(1)
	ta.FocusedStyle.Prompt = lipgloss.NewStyle().Foreground(lipgloss.Color("#7daea3"))
	ta.FocusedStyle.CursorLine = lipgloss.NewStyle()
	ta.FocusedStyle.Base = lipgloss.NewStyle().
	Border(lipgloss.RoundedBorder()).
	BorderForeground(lipgloss.Color("#7daea3"))
	ta.BlurredStyle.Base = lipgloss.NewStyle().
	Border(lipgloss.RoundedBorder()).
	BorderForeground(lipgloss.Color("#7daea3"))

	ta.FocusedStyle.CursorLine = lipgloss.NewStyle()

	ta.ShowLineNumbers = false

	vp := viewport.New(30, 5)

	styledHeader := lipgloss.NewStyle().
	Foreground(lipgloss.Color("#da7757")).
	Render(header)
	centeredHeader := lipgloss.Place(
		vp.Width,
		vp.Height,
		lipgloss.Center,
		lipgloss.Center,
		styledHeader,
	)
	vp.SetContent(centeredHeader)

	ta.KeyMap.InsertNewline.SetEnabled(false)
	s := spinner.New()
	s.Spinner = spinner.Points
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("#da7757"))
	commands := []command{
		command { 
			name: "ask",
			help: "[query] Ask the LLM a question. This is the default command so you don't have to specify it",
			fn: askCommand,
		},
		command {
			name: "remember",
			help: "[data] Give the LLM context to remember for future conversations",
			fn: rememberCommand,
		},
		command {
			name: "clear",
			help: "clears the screen",
			fn: clearCommand,
		},
		command { 
			name: "quit",
			help: "exit the application",
			fn: quitCommand,
		},
		command {
			name: "help",
			help: "print this help message",
			fn: helpCommand,
		},
	}

	keybinds := []keybind{
		keybind {
			name: "enter",
			desc: "submit whatever is in the input field",
			action: enterAction,
		},
		keybind {
			name: "ctrl+c",
			desc: "quit the application",
			action: ctrlcAction,
		},
		keybind {
			name: "esc",
			desc: "enter normal mode from insert mode",
			action: escAction,
		},
		keybind {
			name: "i",
			desc: "enter insert mode from normal mode",
			action: iAction,
		},
	}

	return model{
		textarea:    ta,
		messages:    []string{},
		viewport:    vp,
		senderStyle: lipgloss.NewStyle().Foreground(lipgloss.Color("#7daea3")),
		botStyle: lipgloss.NewStyle().Foreground(lipgloss.Color("#da7757")),
		spinner: s,
		commands: commands,
		keybinds: keybinds,
		header: styledHeader,
		mode: insertMode,
		err:         nil,
	}
}

func (m model) Init() tea.Cmd {
	return tea.Batch(textarea.Blink, m.spinner.Tick)
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var (
		tiCmd tea.Cmd
		vpCmd tea.Cmd
	)

	if m.mode == insertMode {
		m.textarea, tiCmd = m.textarea.Update(msg)
	}
	if m.mode == normalMode {
		m.viewport, vpCmd = m.viewport.Update(msg)
	}

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.viewport.Width = msg.Width
		m.textarea.SetWidth(msg.Width)
		m.viewport.Height = msg.Height - m.textarea.Height() - lipgloss.Height(gap)

		if len(m.messages) > 0 {
			m.viewport.SetContent(lipgloss.NewStyle().Width(m.viewport.Width).Render(strings.Join(m.messages, "\n")))
		} else {
			centeredHeader := lipgloss.Place(
				m.viewport.Width,
				m.viewport.Height,
				lipgloss.Center,
				lipgloss.Center,
				m.header,
			)
			m.viewport.SetContent(centeredHeader)
		}
	m.viewport.GotoBottom()
	case tea.KeyMsg:
		for _, keybind := range m.keybinds {
			if msg.String() == keybind.name {
				return keybind.action(&m)
			}
		}
	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		if m.waiting {
			m.messages[len(m.messages)-1] = m.spinner.View() + " Searching knowledge base..."
			m.viewport.SetContent(lipgloss.NewStyle().Width(m.viewport.Width).Render(strings.Join(m.messages, "\n")))
		}
		return m, cmd

	case resMsg:
		m.waiting = false
		if len(m.messages) > 0 {
			m.messages = m.messages[:len(m.messages)-1]
		}
		if msg.Success {
			renderer := getMarkdownRenderer(m.viewport.Width-4)
			renderedAnswer, err := renderer.Render(msg.Answer)
			if err != nil {
				renderedAnswer = msg.Answer
			}
			renderedAnswer = strings.TrimSpace(renderedAnswer)
			m.messages = append(m.messages, m.botStyle.Render("Bot:")+renderedAnswer)
		} else {
			m.messages = append(m.messages, m.botStyle.Render("Bot: ")+"Error: "+msg.Answer)
		}
		m.viewport.SetContent(lipgloss.NewStyle().Width(m.viewport.Width).Render(strings.Join(m.messages, "\n")))
		m.viewport.GotoBottom()

	case errMsg:
		m.waiting = false
		m.err = msg
		if len(m.messages) > 0 {
			m.messages = m.messages[:len(m.messages)-1]
		}
		m.messages = append(m.messages, m.senderStyle.Render("Error: ")+msg.Error())
		m.viewport.SetContent(lipgloss.NewStyle().Width(m.viewport.Width).Render(strings.Join(m.messages, "\n")))
		m.viewport.GotoBottom()
		return m, nil
	}

	return m, tea.Batch(tiCmd, vpCmd)
}

func (m model) View() string {
	return fmt.Sprintf(
		"%s%s%s",
		m.viewport.View(),
		gap,
		m.textarea.View(),
	)
}

func isPortOpen(host string, port int) bool {
    address := fmt.Sprintf("%s:%d", host, port)
    timeout := 2 * time.Second
    
    conn, err := net.DialTimeout("tcp", address, timeout)
    if err != nil {
        return false
    }
    conn.Close()
    return true
}

func main() {
	if !isPortOpen("localhost",6969) {
		go func() {
			cmd := exec.Command("/home/alchemist/.local/bin/gatekeeper", "--serve");
			err := cmd.Run()
			if err != nil {
				fmt.Println("Error:", err)
			}
		}()
	}
	p := tea.NewProgram(initialModel(), tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		log.Fatal(err)
	}
	cmd := exec.Command("pkill", "gatekeeper");
	err := cmd.Run()
	if err != nil {
		fmt.Println("Error:", err)
	}
}
