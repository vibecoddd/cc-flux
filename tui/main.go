package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"os"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Config Utils
func getProxyPort() string {
	// 1. Check Env Var Override
	if p := os.Getenv("CC_FLUX_PORT"); p != "" {
		return p
	}

	// 2. Try to read from proxy/.env
	// Assuming tui is running from tui/ dir, proxy is in ../proxy
	// Or if running from root, proxy is in proxy/
	paths := []string{
		"../proxy/.env",
		"proxy/.env",
		"./.env",
	}

	for _, p := range paths {
		content, err := ioutil.ReadFile(p)
		if err == nil {
			return parseEnvPort(string(content))
		}
	}

	return "8080" // Default
}

func parseEnvPort(content string) string {
	lines := strings.Split(content, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "PORT=") {
			return strings.TrimSpace(strings.TrimPrefix(line, "PORT="))
		}
	}
	return "8080"
}

// Global API URL
var apiBaseUrl = "http://localhost:" + getProxyPort()

// Styles
var (

	appStyle = lipgloss.NewStyle().Margin(1, 2)
	titleStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#FFFDF5")).
			Background(lipgloss.Color("#25A065")).
			Padding(0, 1)
	itemStyle = lipgloss.NewStyle().PaddingLeft(2)
	selectedItemStyle = lipgloss.NewStyle().
			PaddingLeft(2).
			Foreground(lipgloss.Color("170"))
	statusStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
)

// Provider represents a backend model provider
type Provider struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Provider     string `json:"provider"`
	BaseURL      string `json:"baseUrl"`
	APIKey       string `json:"apiKey"`
	Model        string `json:"model"`
	RetryEnabled bool   `json:"retryEnabled"`
}

type SwitchPayload struct {
	ID string `json:"id"`
}

type CompressionStatus struct {
	Enabled     bool `json:"enabled"`
	MaxMessages int  `json:"maxMessages"`
	KeepRecent  int  `json:"keepRecent"`
}

type RuntimeStatus struct {
	Provider         string            `json:"provider"`
	Model            string            `json:"model"`
	ActiveProviderID string            `json:"activeProviderId"`
	Compression      CompressionStatus `json:"compression"`
}

type CurrentResponse struct {
	Config RuntimeStatus `json:"config"`
}

type CompressionPayload struct {
	Enabled bool `json:"enabled"`
}

type model struct {
	providers []Provider
	cursor    int
	status    string
	err       error
	runtime   RuntimeStatus
}

func initialModel() model {
	// Load providers from JSON
	file, err := ioutil.ReadFile("providers.json")
	var providers []Provider
	if err == nil {
		json.Unmarshal(file, &providers)
	} else {
		// Fallback defaults
		providers = []Provider{
			{ID: "openai", Name: "OpenAI (Default)", Provider: "openai", BaseURL: "https://api.openai.com/v1"},
		}
	}

	return model{
		providers: providers,
		status:    "Ready. Select a model and press Enter.",
	}
}

func (m model) Init() tea.Cmd {
	return fetchCurrentStatus("")
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q":
			return m, tea.Quit
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			if m.cursor < len(m.providers)-1 {
				m.cursor++
			}
		case "enter":
			selected := m.providers[m.cursor]
			m.status = fmt.Sprintf("Switching to %s...", selected.Name)
			return m, updateProxyConfig(selected)
		case "c":
			m.status = "Toggling compression..."
			return m, toggleCompression(m.runtime.Compression.Enabled)
		}
	case statusMsg:
		m.status = string(msg)
	case currentStatusMsg:
		m.runtime = msg.Runtime
		if msg.Status != "" {
			m.status = msg.Status
		} else {
			m.status = "Ready. Select a model and press Enter."
		}
	case errMsg:
		m.err = msg
		m.status = "Error updating proxy."
	}
	return m, nil
}

func (m model) View() string {
	s := titleStyle.Render("CC-Flux Controller") + "\n\n"

	for i, choice := range m.providers {
		cursor := " "
		if m.cursor == i {
			cursor = ">"
			s += selectedItemStyle.Render(fmt.Sprintf("%s %s", cursor, choice.Name)) + "\n"
		} else {
			s += itemStyle.Render(fmt.Sprintf("%s %s", cursor, choice.Name)) + "\n"
		}
	}

	s += "\n" + statusStyle.Render(m.status) + "\n"
	if m.runtime.Provider != "" || m.runtime.Model != "" {
		active := fmt.Sprintf("Active: %s/%s", m.runtime.Provider, m.runtime.Model)
		if m.runtime.ActiveProviderID != "" {
			active += fmt.Sprintf(" (%s)", m.runtime.ActiveProviderID)
		}
		s += statusStyle.Render(active) + "\n"
		compressionState := "disabled"
		if m.runtime.Compression.Enabled {
			compressionState = "enabled"
		}
		s += statusStyle.Render(fmt.Sprintf(
			"Compression: %s (max %d, keep %d)",
			compressionState,
			m.runtime.Compression.MaxMessages,
			m.runtime.Compression.KeepRecent,
		)) + "\n"
	}
	if m.err != nil {
		s += lipgloss.NewStyle().Foreground(lipgloss.Color("9")).Render(m.err.Error()) + "\n"
	}
	s += "\nPress c to toggle compression. Press q to quit.\n"

	return appStyle.Render(s)
}

// Commands
type statusMsg string
type errMsg error
type currentStatusMsg struct {
	Runtime RuntimeStatus
	Status  string
}

func getCurrentStatus() (RuntimeStatus, error) {
	resp, err := http.Get(apiBaseUrl + "/admin/current")
	if err != nil {
		return RuntimeStatus{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := ioutil.ReadAll(resp.Body)
		return RuntimeStatus{}, fmt.Errorf("proxy returned status: %s %s", resp.Status, strings.TrimSpace(string(body)))
	}

	var current CurrentResponse
	if err := json.NewDecoder(resp.Body).Decode(&current); err != nil {
		return RuntimeStatus{}, err
	}

	return current.Config, nil
}

func fetchCurrentStatus(status string) tea.Cmd {
	return func() tea.Msg {
		runtime, err := getCurrentStatus()
		if err != nil {
			return errMsg(err)
		}
		return currentStatusMsg{Runtime: runtime, Status: status}
	}
}

func updateProxyConfig(p Provider) tea.Cmd {
	return func() tea.Msg {
		payload := SwitchPayload{
			ID: p.ID,
		}
		
		jsonData, err := json.Marshal(payload)
		if err != nil {
			return errMsg(err)
		}

		resp, err := http.Post(apiBaseUrl + "/admin/switch", "application/json", bytes.NewBuffer(jsonData))
		if err != nil {
			return errMsg(err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			body, _ := ioutil.ReadAll(resp.Body)
			return errMsg(fmt.Errorf("proxy returned status: %s %s", resp.Status, strings.TrimSpace(string(body))))
		}

		runtime, err := getCurrentStatus()
		if err != nil {
			return errMsg(err)
		}

		return currentStatusMsg{
			Runtime: runtime,
			Status:  fmt.Sprintf("Successfully switched to %s", p.Name),
		}
	}
}

func toggleCompression(current bool) tea.Cmd {
	return func() tea.Msg {
		payload := CompressionPayload{Enabled: !current}
		jsonData, err := json.Marshal(payload)
		if err != nil {
			return errMsg(err)
		}

		resp, err := http.Post(apiBaseUrl + "/admin/compression", "application/json", bytes.NewBuffer(jsonData))
		if err != nil {
			return errMsg(err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			body, _ := ioutil.ReadAll(resp.Body)
			return errMsg(fmt.Errorf("proxy returned status: %s %s", resp.Status, strings.TrimSpace(string(body))))
		}

		runtime, err := getCurrentStatus()
		if err != nil {
			return errMsg(err)
		}

		state := "disabled"
		if runtime.Compression.Enabled {
			state = "enabled"
		}
		return currentStatusMsg{
			Runtime: runtime,
			Status:  fmt.Sprintf("Compression %s", state),
		}
	}
}

func main() {
	p := tea.NewProgram(initialModel())
	if _, err := p.Run(); err != nil {
		fmt.Printf("Alas, there's been an error: %v", err)
		os.Exit(1)
	}
}
