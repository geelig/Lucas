package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	migrateLegacyWebKitData()
	app := NewApp()
	err := wails.Run(&options.App{
		Title: "", Width: 1440, Height: 920, MinWidth: 980, MinHeight: 640,
		BackgroundColour: &options.RGBA{R: 12, G: 14, B: 24, A: 1},
		AssetServer:      &assetserver.Options{Assets: assets},
		OnStartup:        app.startup, OnShutdown: app.shutdown,
		Bind: []interface{}{app},
		Mac:  &mac.Options{TitleBar: mac.TitleBarHidden(), About: &mac.AboutInfo{Title: "Lucas", Message: "Independent workspace for terminals and remote files", Icon: nil}},
	})
	if err != nil {
		panic(err)
	}
}
