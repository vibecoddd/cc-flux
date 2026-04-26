package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUpdateProxyConfigSwitchesByProfileID(t *testing.T) {
	var requestPath string
	var requestBody map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

	if _, ok := msg.(statusMsg); !ok {
		t.Fatalf("expected statusMsg, got %T: %v", msg, msg)
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
}
