package store

import "time"

// Profile is Lucas's independent, serializable connection description.
type Profile struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Protocol   string    `json:"protocol"` // local, ssh, telnet, serial, ftp
	GroupID    string    `json:"groupId,omitempty"`
	Host       string    `json:"host,omitempty"`
	Port       int       `json:"port,omitempty"`
	Username   string    `json:"username,omitempty"`
	Auth       string    `json:"auth,omitempty"` // password, key, agent
	Password   string    `json:"password,omitempty"`
	KeyPath    string    `json:"privateKeyPath,omitempty"`
	Passphrase string    `json:"passphrase,omitempty"`
	SerialPort string    `json:"serialPort,omitempty"`
	Baud       int       `json:"baudRate,omitempty"`
	DataBits   int       `json:"dataBits,omitempty"`
	StopBits   int       `json:"stopBits,omitempty"`
	Parity     string    `json:"parity,omitempty"`
	Flow       string    `json:"flowControl,omitempty"`
	Shell      string    `json:"shell,omitempty"`
	Directory  string    `json:"directory,omitempty"`
	JumpID     string    `json:"jumpProfileId,omitempty"`
	Encoding   string    `json:"encoding,omitempty"`
	Color      string    `json:"color,omitempty"`
	OS         string    `json:"os,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type Group struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	ParentID string `json:"parentId,omitempty"`
	Order    int    `json:"order"`
}

type Document struct {
	Groups     []Group   `json:"groups"`
	Profiles   []Profile `json:"profiles"`
	GroupOrder []string  `json:"groupOrder"`
}
