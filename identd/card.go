package main

import (
	"bytes"
	"context"
	_ "embed"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"strings"
	"sync"
	"time"

	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
	"golang.org/x/image/vector"
)

// Background card rendered by the demo HTML at build time (Ident wordmark,
// tagline, radar) with the footer area left empty. The live pill + status row
// is overlaid here at serve time. See ident/scripts/og-card-bg.html.
//
//go:embed og_card_bg.png
var cardBackgroundPNG []byte

// IBM Plex Mono (subset to the glyphs the overlay needs) so the pill and status
// row match the IBM Plex used in the background. OFL-1.1, see fonts/OFL.txt.
//
//go:embed fonts/IBMPlexMono-SemiBold.subset.ttf
var pillTTF []byte

//go:embed fonts/IBMPlexMono-Medium.subset.ttf
var statusTTF []byte

const (
	cardW = 1200
	cardH = 630
)

// Overlay geometry, matched to the footer row in the background layout.
const (
	pillX0    = 84
	pillTop   = 444
	pillH     = 35
	pillRad   = 6
	pillPadX  = 15
	rowGap    = 18
	dotR      = 4.5
	dotCY     = 461
	textBase  = 468 // shared baseline for pill text + status
	dotGap    = 12
	pillPxH   = 20.0
	statusPxH = 25.0
)

type cardRenderer struct {
	bg        image.Image
	pillFace  font.Face
	statFace  font.Face
	stats     func() CardStats
	cacheTTL  time.Duration
	mu        sync.RWMutex
	cachedPNG []byte
}

func parseFace(ttf []byte, px float64) (font.Face, error) {
	f, err := opentype.Parse(ttf)
	if err != nil {
		return nil, err
	}
	return opentype.NewFace(f, &opentype.FaceOptions{Size: px, DPI: 72, Hinting: font.HintingFull})
}

func newCardRenderer(stats func() CardStats) (*cardRenderer, error) {
	bg, err := png.Decode(bytes.NewReader(cardBackgroundPNG))
	if err != nil {
		return nil, fmt.Errorf("decode card background: %w", err)
	}
	pillFace, err := parseFace(pillTTF, pillPxH)
	if err != nil {
		return nil, err
	}
	statFace, err := parseFace(statusTTF, statusPxH)
	if err != nil {
		return nil, err
	}
	return &cardRenderer{
		bg:       bg,
		pillFace: pillFace,
		statFace: statFace,
		stats:    stats,
		cacheTTL: 45 * time.Second,
	}, nil
}

func hexColor(s string) color.RGBA {
	var r, g, b uint8
	fmt.Sscanf(s, "#%02x%02x%02x", &r, &g, &b)
	return color.RGBA{r, g, b, 255}
}

func textWidth(face font.Face, s string) int {
	d := &font.Drawer{Face: face}
	return d.MeasureString(s).Round()
}

func drawText(dst draw.Image, face font.Face, col color.Color, x, baseline int, s string) {
	d := &font.Drawer{Dst: dst, Src: image.NewUniform(col), Face: face, Dot: fixed.P(x, baseline)}
	d.DrawString(s)
}

func fillRoundRect(dst draw.Image, x0, y0, x1, y1, r float32, col color.Color) {
	ras := vector.NewRasterizer(cardW, cardH)
	ras.MoveTo(x0+r, y0)
	ras.LineTo(x1-r, y0)
	ras.QuadTo(x1, y0, x1, y0+r)
	ras.LineTo(x1, y1-r)
	ras.QuadTo(x1, y1, x1-r, y1)
	ras.LineTo(x0+r, y1)
	ras.QuadTo(x0, y1, x0, y1-r)
	ras.LineTo(x0, y0+r)
	ras.QuadTo(x0, y0, x0+r, y0)
	ras.ClosePath()
	ras.Draw(dst, dst.Bounds(), image.NewUniform(col), image.Point{})
}

func fillDisc(dst draw.Image, cx, cy, r float32, col color.Color) {
	ras := vector.NewRasterizer(cardW, cardH)
	const n = 48
	for i := 0; i <= n; i++ {
		t := float64(i) / n * 2 * math.Pi
		x := cx + r*float32(math.Cos(t))
		y := cy + r*float32(math.Sin(t))
		if i == 0 {
			ras.MoveTo(x, y)
		} else {
			ras.LineTo(x, y)
		}
	}
	ras.ClosePath()
	ras.Draw(dst, dst.Bounds(), image.NewUniform(col), image.Point{})
}

func statusLine(s CardStats) string {
	parts := make([]string, 0, 3)
	if s.HasRate {
		parts = append(parts, fmt.Sprintf("%.0f msg/s", s.MessageRate))
	}
	parts = append(parts, fmt.Sprintf("%d aircraft", s.Aircraft))
	if s.HasRange {
		parts = append(parts, fmt.Sprintf("%.0f nm", s.MaxRangeNM))
	}
	return strings.Join(parts, " · ")
}

func (c *cardRenderer) render() ([]byte, error) {
	img := image.NewRGBA(image.Rect(0, 0, cardW, cardH))
	draw.Draw(img, img.Bounds(), c.bg, image.Point{}, draw.Src)

	s := c.stats()
	cInk := hexColor("#0f1113")
	cOrange := hexColor("#f27200")
	cGreen := hexColor("#2dc07d")
	cStatus := hexColor("#9fa6ae")

	x := float32(pillX0)
	station := strings.TrimSpace(s.Station)
	if station != "" {
		pw := float32(pillPadX*2 + textWidth(c.pillFace, station))
		fillRoundRect(img, pillX0, pillTop, pillX0+pw, pillTop+pillH, pillRad, cOrange)
		drawText(img, c.pillFace, cInk, pillX0+pillPadX, textBase, station)
		x = pillX0 + pw + rowGap
	}

	fillDisc(img, x+dotR, dotCY, dotR, cGreen)
	drawText(img, c.statFace, cStatus, int(x+dotR*2+dotGap), textBase, statusLine(s))

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func (c *cardRenderer) refresh() error {
	b, err := c.render()
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.cachedPNG = b
	c.mu.Unlock()
	return nil
}

// Bytes returns the most recently rendered PNG (empty until the first refresh).
func (c *cardRenderer) Bytes() []byte {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.cachedPNG
}

// Run renders immediately, then re-renders on a timer so each request serves
// cached bytes in O(1) and a burst of scraper hits can't trigger work per call.
func (c *cardRenderer) Run(ctx context.Context) {
	_ = c.refresh()
	ticker := time.NewTicker(c.cacheTTL)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = c.refresh()
		}
	}
}
