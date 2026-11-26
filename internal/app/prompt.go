package app

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
)

var ErrPromptClosed = errors.New("应用正在关闭，认证已取消")

type PromptRequest struct {
	ID          string `json:"id"`
	SessionID   string `json:"sessionId"`
	Prompt      string `json:"prompt"`
	Echo        bool   `json:"echo"`
	Title       string `json:"title,omitempty"`
	Message     string `json:"message,omitempty"`
	Kind        string `json:"kind,omitempty"`
	Fingerprint string `json:"fingerprint,omitempty"`
	Changed     bool   `json:"changed,omitempty"`
}

type pendingPrompt struct {
	answer chan string
	closed chan struct{}
}

type PromptBroker struct {
	mu       sync.Mutex
	pending  map[string]pendingPrompt
	emit     func(PromptRequest)
	closed   bool
	closedCh chan struct{}
}

func NewPromptBroker(emit func(PromptRequest)) *PromptBroker {
	return &PromptBroker{pending: map[string]pendingPrompt{}, emit: emit, closedCh: make(chan struct{})}
}

func randomID() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(raw[:])
}

func (b *PromptBroker) Ask(sessionID, question string, echo bool) (string, error) {
	kind := "text"
	if !echo {
		kind = "password"
	}
	return b.request(PromptRequest{SessionID: sessionID, Prompt: question, Message: question, Echo: echo, Kind: kind})
}

func (b *PromptBroker) Confirm(request PromptRequest) (bool, error) {
	answer, err := b.request(request)
	return answer == "yes", err
}

func (b *PromptBroker) request(request PromptRequest) (string, error) {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return "", ErrPromptClosed
	}
	request.ID = randomID()
	id := request.ID
	pending := pendingPrompt{answer: make(chan string, 1), closed: b.closedCh}
	b.pending[id] = pending
	b.mu.Unlock()
	b.emit(request)
	select {
	case value := <-pending.answer:
		return value, nil
	case <-pending.closed:
		return "", ErrPromptClosed
	}
}

func (b *PromptBroker) Answer(id, answer string) error {
	b.mu.Lock()
	pending, ok := b.pending[id]
	if ok {
		delete(b.pending, id)
	}
	b.mu.Unlock()
	if !ok {
		return errors.New("认证请求已失效")
	}
	pending.answer <- answer
	return nil
}

func (b *PromptBroker) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return
	}
	b.closed = true
	b.pending = map[string]pendingPrompt{}
	close(b.closedCh)
}
