package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestUpdateProxyConfigSwitchesByProfileID(t *testing.T) {
	var requestPath string
	var requestBody map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/admin/current" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"config":{"provider":"deepseek","model":"deepseek-reasoner","activeProviderId":"deepseek-reasoner","compression":{"enabled":false,"maxMessages":40,"keepRecent":16}}}`))
			return
		}
		requestPath = r.URL.Path
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"switched"}`))
	}))
	defer server.Close()

	previousURL := apiBaseUrl
	apiBaseUrl = server.URL
	defer func() {
		apiBaseUrl = previousURL
	}()

	msg := updateProxyConfig(Provider{
		ID:       "deepseek-reasoner",
		Name:     "DeepSeek - Reasoner (R1)",
		Provider: "deepseek",
		BaseURL:  "https://api.deepseek.com",
		APIKey:   "sk-secret",
		Model:    "deepseek-reasoner",
	})()

	status, ok := msg.(currentStatusMsg)
	if !ok {
		t.Fatalf("expected currentStatusMsg, got %T: %v", msg, msg)
	}
	if requestPath != "/admin/switch" {
		t.Fatalf("expected /admin/switch path, got %q", requestPath)
	}
	if requestBody["id"] != "deepseek-reasoner" {
		t.Fatalf("expected profile id payload, got %#v", requestBody)
	}
	if _, ok := requestBody["apiKey"]; ok {
		t.Fatalf("payload leaked apiKey: %#v", requestBody)
	}
	if status.Runtime.ActiveProviderID != "deepseek-reasoner" {
		t.Fatalf("expected refreshed active provider, got %#v", status.Runtime)
	}
}

func TestToggleCompressionPostsOppositeStateAndRefreshesStatus(t *testing.T) {
	var requestPath string
	var requestBody map[string]bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/admin/current" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"config":{"provider":"openai","model":"gpt-4o","activeProviderId":"openai-gpt4o","compression":{"enabled":true,"maxMessages":40,"keepRecent":16}}}`))
			return
		}
		requestPath = r.URL.Path
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"compression":{"enabled":true,"maxMessages":40,"keepRecent":16}}`))
	}))
	defer server.Close()

	previousURL := apiBaseUrl
	apiBaseUrl = server.URL
	defer func() {
		apiBaseUrl = previousURL
	}()

	msg := toggleCompression(false)()
	status, ok := msg.(currentStatusMsg)
	if !ok {
		t.Fatalf("expected currentStatusMsg, got %T: %v", msg, msg)
	}
	if requestPath != "/admin/compression" {
		t.Fatalf("expected /admin/compression path, got %q", requestPath)
	}
	if requestBody["enabled"] != true {
		t.Fatalf("expected enabled payload, got %#v", requestBody)
	}
	if !status.Runtime.Compression.Enabled {
		t.Fatalf("expected refreshed compression status, got %#v", status.Runtime.Compression)
	}
}

func TestRefreshKeyFetchesCurrentStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/admin/current" {
			t.Fatalf("expected /admin/current path, got %q", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"config":{"provider":"openai","model":"gpt-4o","activeProviderId":"openai-gpt4o","compression":{"enabled":false,"maxMessages":40,"keepRecent":16}}}`))
	}))
	defer server.Close()

	previousURL := apiBaseUrl
	apiBaseUrl = server.URL
	defer func() {
		apiBaseUrl = previousURL
	}()

	m := initialModel()
	updated, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'r'}})
	model, ok := updated.(model)
	if !ok {
		t.Fatalf("expected model, got %T", updated)
	}
	if model.status != "Refreshing status..." {
		t.Fatalf("expected refresh status, got %q", model.status)
	}

	msg := cmd()
	status, ok := msg.(currentStatusMsg)
	if !ok {
		t.Fatalf("expected currentStatusMsg, got %T: %v", msg, msg)
	}
	if status.Status != "Status refreshed" {
		t.Fatalf("expected refresh confirmation, got %q", status.Status)
	}
	if status.Runtime.ActiveProviderID != "openai-gpt4o" {
		t.Fatalf("expected refreshed active provider, got %#v", status.Runtime)
	}
}

func TestAdminRequestsUseConfiguredToken(t *testing.T) {
	t.Setenv("CC_FLUX_ADMIN_TOKEN", "secret")

	var authorization string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"config":{"provider":"openai","model":"gpt-4o","activeProviderId":"openai-gpt4o","compression":{"enabled":false,"maxMessages":40,"keepRecent":16}}}`))
	}))
	defer server.Close()

	previousURL := apiBaseUrl
	apiBaseUrl = server.URL
	defer func() {
		apiBaseUrl = previousURL
	}()

	if _, err := getCurrentStatus(); err != nil {
		t.Fatalf("get current status: %v", err)
	}
	if authorization != "Bearer secret" {
		t.Fatalf("expected Authorization bearer token, got %q", authorization)
	}
}
