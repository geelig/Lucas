package app

import (
	"testing"
	"time"
)

func TestPromptAnswerAndCancellation(t *testing.T) {
	events := make(chan PromptRequest, 1)
	broker := NewPromptBroker(func(value PromptRequest) { events <- value })
	answer := make(chan string, 1)
	go func() {
		value, err := broker.Ask("session", "Verification code", false)
		if err != nil {
			t.Errorf("Ask: %v", err)
		}
		answer <- value
	}()
	request := <-events
	if request.SessionID != "session" || request.Echo {
		t.Fatalf("bad request: %+v", request)
	}
	if err := broker.Answer(request.ID, "123456"); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-answer:
		if got != "123456" {
			t.Fatalf("answer = %q", got)
		}
	case <-time.After(time.Second):
		t.Fatal("answer not delivered")
	}
	if err := broker.Answer(request.ID, "again"); err == nil {
		t.Fatal("duplicate answer accepted")
	}

	done := make(chan error, 1)
	go func() { _, err := broker.Ask("session", "Password", false); done <- err }()
	<-events
	broker.Close()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("close did not cancel prompt")
		}
	case <-time.After(time.Second):
		t.Fatal("prompt remained blocked")
	}
}

func TestHostKeyConfirmation(t *testing.T) {
	events := make(chan PromptRequest, 1)
	broker := NewPromptBroker(func(value PromptRequest) { events <- value })
	result := make(chan bool, 1)
	go func() {
		ok, err := broker.Confirm(PromptRequest{Kind: "hostkey", Message: "example.test", Fingerprint: "SHA256:test"})
		if err != nil {
			t.Errorf("Confirm: %v", err)
		}
		result <- ok
	}()
	request := <-events
	if request.ID == "" || request.Kind != "hostkey" {
		t.Fatalf("request = %+v", request)
	}
	if err := broker.Answer(request.ID, "yes"); err != nil {
		t.Fatal(err)
	}
	if !(<-result) {
		t.Fatal("confirmation was not accepted")
	}
}
