#!/usr/bin/env python3
"""
AI Trading Bot — Textual TUI Dashboard

Connects to the running FootballTracker server and displays
live portfolio data in a rich terminal interface.

Requirements:
    pip install textual httpx

Usage:
    python tui_dashboard.py [--host http://localhost:3000]

Keyboard shortcuts:
    r / F5   — Refresh data now
    t        — Trigger a trading cycle (POST /api/trading/run)
    q / Ctrl+C — Quit
"""

import argparse
import asyncio
from datetime import datetime

import httpx
from textual import work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container, Horizontal, Vertical, ScrollableContainer
from textual.reactive import reactive
from textual.widgets import (
    DataTable, Footer, Header, Label, LoadingIndicator,
    Sparkline, Static,
)
from textual.widget import Widget
from textual.timer import Timer

# ── Helpers ──────────────────────────────────────────────────────────────────

def fmt_dollar(n):
    if n is None:
        return "—"
    sign = "-" if n < 0 else ""
    return f"{sign}${abs(n):,.2f}"

def fmt_pct(n, prefix_sign=True):
    if n is None:
        return "—"
    sign = "+" if n >= 0 and prefix_sign else ""
    return f"{sign}{n:.2f}%"

def color_for(n):
    """Return a Textual markup color based on sign."""
    if n is None:
        return "dim"
    return "green" if n >= 0 else "red"

def ts():
    return datetime.now().strftime("%H:%M:%S")


# ── Summary card widget ───────────────────────────────────────────────────────

class SummaryCard(Static):
    """A single KPI card: label on top, big value, sub-text below."""

    DEFAULT_CSS = """
    SummaryCard {
        border: round $primary-darken-2;
        background: $surface;
        padding: 0 1;
        height: 7;
        width: 1fr;
        content-align: center middle;
    }
    SummaryCard .card-label {
        color: $text-muted;
        text-style: bold;
    }
    SummaryCard .card-value {
        text-style: bold;
        content-align: center middle;
    }
    SummaryCard .card-sub {
        color: $text-muted;
    }
    """

    def __init__(self, label: str, **kwargs):
        super().__init__(**kwargs)
        self._label = label

    def compose(self) -> ComposeResult:
        yield Label(self._label, classes="card-label")
        yield Label("—", classes="card-value", id=f"val_{self.id}")
        yield Label("", classes="card-sub", id=f"sub_{self.id}")

    def update_card(self, value: str, sub: str = "", value_color: str = "white"):
        self.query_one(f"#val_{self.id}", Label).update(
            f"[bold {value_color}]{value}[/]"
        )
        self.query_one(f"#sub_{self.id}", Label).update(
            f"[dim]{sub}[/]"
        )


# ── AI Summary banner ─────────────────────────────────────────────────────────

class AIBanner(Static):
    DEFAULT_CSS = """
    AIBanner {
        background: $surface;
        border-left: heavy $success;
        padding: 0 2;
        height: 3;
        color: $text;
        text-style: italic;
    }
    """

    def update_summary(self, text: str):
        self.update(f"[dim]🤖[/]  [italic]{text}[/]" if text else "[dim]No AI summary yet.[/]")


# ── Sparkline chart area ──────────────────────────────────────────────────────

class PerformanceChart(Static):
    """Shows portfolio vs SPY as inline sparklines with labels."""

    DEFAULT_CSS = """
    PerformanceChart {
        background: $surface;
        border: round $primary-darken-2;
        padding: 1 2;
        height: 10;
    }
    """

    def compose(self) -> ComposeResult:
        yield Label("[bold]Portfolio Performance vs S&P 500[/] (daily close, $k)")
        with Horizontal():
            with Vertical(id="spark_portfolio_wrap"):
                yield Label("[green]▸ Portfolio[/]", classes="spark-label")
                yield Sparkline([], id="spark_portfolio", summary_function=max)
            with Vertical(id="spark_spy_wrap"):
                yield Label("[blue]▸ S&P 500 (indexed)[/]", classes="spark-label")
                yield Sparkline([], id="spark_spy", summary_function=max)

    def update_chart(self, snapshots: list):
        portfolio_vals = [s.get("portfolioValue", 0) for s in snapshots]
        spy_vals = [s.get("spyIndexedValue") or 0 for s in snapshots]
        self.query_one("#spark_portfolio", Sparkline).data = portfolio_vals
        self.query_one("#spark_spy", Sparkline).data = spy_vals


# ── Main app ──────────────────────────────────────────────────────────────────

class TradingDashboard(App):
    """Textual TUI for the AI Trading Bot."""

    TITLE = "AI Trading Bot"
    SUB_TITLE = "Fictional stocks · Live market data · Powered by Claude AI"

    CSS = """
    Screen {
        background: #1e1e1e;
        layout: vertical;
    }
    #summary_row {
        height: 7;
        layout: horizontal;
        margin-bottom: 1;
    }
    #ai_banner { margin-bottom: 1; }
    #perf_chart { margin-bottom: 1; }
    #tables_row {
        layout: horizontal;
        height: 1fr;
        margin-bottom: 1;
    }
    #holdings_panel {
        width: 1fr;
        border: round $primary-darken-2;
        background: $surface;
        padding: 0 1;
    }
    #market_panel {
        width: 1fr;
        border: round $primary-darken-2;
        background: $surface;
        padding: 0 1;
        margin-left: 1;
    }
    #trades_panel {
        border: round $primary-darken-2;
        background: $surface;
        padding: 0 1;
        height: 16;
    }
    .panel-title {
        color: $text-muted;
        text-style: bold;
        padding: 0 0 1 0;
    }
    #status_bar {
        height: 1;
        background: $surface-darken-1;
        padding: 0 1;
        color: $text-muted;
    }
    DataTable {
        background: $surface;
        height: 1fr;
    }
    """

    BINDINGS = [
        Binding("r,f5", "refresh", "Refresh", show=True),
        Binding("t", "trigger_trade", "Run Trade Cycle", show=True),
        Binding("q", "quit", "Quit", show=True),
    ]

    server_url: str = "http://localhost:3000"
    _refresh_timer: Timer | None = None
    _status_text: reactive[str] = reactive("Initialising…")

    def __init__(self, host: str = "http://localhost:3000", **kwargs):
        super().__init__(**kwargs)
        self.server_url = host.rstrip("/")

    # ── Layout ────────────────────────────────────────────────────────────────

    def compose(self) -> ComposeResult:
        yield Header()

        # KPI cards
        with Horizontal(id="summary_row"):
            yield SummaryCard("Portfolio Value",  id="card_value")
            yield SummaryCard("Cash Available",   id="card_cash")
            yield SummaryCard("Total P&L",        id="card_pnl")
            yield SummaryCard("vs S&P 500",       id="card_spy")

        # AI summary
        yield AIBanner(id="ai_banner")

        # Sparkline chart
        yield PerformanceChart(id="perf_chart")

        # Holdings + Market side by side
        with Horizontal(id="tables_row"):
            with Container(id="holdings_panel"):
                yield Label("Holdings", classes="panel-title")
                yield DataTable(id="holdings_table", zebra_stripes=True, cursor_type="row")

            with Container(id="market_panel"):
                yield Label("Live Market Prices", classes="panel-title")
                yield DataTable(id="market_table", zebra_stripes=True, cursor_type="row")

        # Trade log
        with Container(id="trades_panel"):
            yield Label("Recent AI Trades", classes="panel-title")
            yield DataTable(id="trades_table", zebra_stripes=True, cursor_type="row")

        yield Static(id="status_bar")
        yield Footer()

    def on_mount(self):
        # Set up table columns
        holdings = self.query_one("#holdings_table", DataTable)
        holdings.add_columns("Symbol", "Shares", "Avg Cost", "Price", "P&L", "P&L %")

        market = self.query_one("#market_table", DataTable)
        market.add_columns("Symbol", "Company", "Price", "Change", "Sector")

        trades = self.query_one("#trades_table", DataTable)
        trades.add_columns("Date", "Symbol", "Action", "Shares", "Price", "AI Reasoning")

        # Initial load + auto-refresh every 60 seconds
        self.action_refresh()
        self._refresh_timer = self.set_interval(60, self.action_refresh)

    # ── Data loading ──────────────────────────────────────────────────────────

    @work(exclusive=True, thread=True)
    def action_refresh(self):
        self.call_from_thread(self._set_status, f"[dim]Refreshing… {ts()}[/]")
        try:
            with httpx.Client(timeout=15) as client:
                portfolio_resp = client.get(f"{self.server_url}/api/trading/portfolio")
                history_resp   = client.get(f"{self.server_url}/api/trading/history")
                stocks_resp    = client.get(f"{self.server_url}/api/trading/stocks")
                status_resp    = client.get(f"{self.server_url}/api/trading/status")

            portfolio = portfolio_resp.json()
            history   = history_resp.json()
            stocks    = stocks_resp.json()
            status    = status_resp.json()

            self.call_from_thread(self._render_all, portfolio, history, stocks, status)
        except Exception as exc:
            self.call_from_thread(
                self._set_status,
                f"[red]Error: {exc}  — is the server running at {self.server_url}?[/]",
            )

    def _render_all(self, portfolio, history, stocks, status):
        self._render_cards(portfolio)
        self._render_holdings(portfolio.get("positions", []))
        self._render_trades(portfolio.get("recentTrades", []))
        self._render_market(stocks.get("stocks", []))
        self._render_chart(history.get("snapshots", []))
        self.query_one("#ai_banner", AIBanner).update_summary(
            portfolio.get("marketSummary", "")
        )
        last_run = status.get("lastRunDate") or "never"
        running  = status.get("isRunning", False)
        indicator = "[yellow]● RUNNING[/]" if running else "[green]●[/]"
        self._set_status(
            f"{indicator}  Last run: [bold]{last_run}[/]  ·  "
            f"Next: [bold]{status.get('nextRun', '—')[:16]}[/] UTC  ·  "
            f"Refreshed [bold]{ts()}[/]  (r=refresh  t=trade  q=quit)"
        )

    def _render_cards(self, p):
        total = p.get("totalValue")
        pnl   = p.get("pnl")
        cash  = p.get("cash")
        invested = p.get("positionsValue")
        pnl_pct  = p.get("pnlPercent")

        snap = p.get("latestSnapshot") or {}
        spy_indexed = snap.get("spyIndexedValue")
        vs_spy = (total - spy_indexed) if total and spy_indexed else None
        vs_spy_pct = ((vs_spy / spy_indexed) * 100) if vs_spy and spy_indexed else None

        self.query_one("#card_value", SummaryCard).update_card(
            fmt_dollar(total),
            sub=f"Start: $100,000",
            value_color=color_for(pnl),
        )
        self.query_one("#card_cash", SummaryCard).update_card(
            fmt_dollar(cash),
            sub=f"{fmt_dollar(invested)} invested",
        )
        self.query_one("#card_pnl", SummaryCard).update_card(
            f"{'+' if pnl and pnl >= 0 else ''}{fmt_dollar(pnl)}",
            sub=fmt_pct(pnl_pct),
            value_color=color_for(pnl),
        )
        self.query_one("#card_spy", SummaryCard).update_card(
            f"{'+' if vs_spy and vs_spy >= 0 else ''}{fmt_dollar(vs_spy)}",
            sub=fmt_pct(vs_spy_pct) + " vs index",
            value_color=color_for(vs_spy),
        )

    def _render_holdings(self, positions):
        table = self.query_one("#holdings_table", DataTable)
        table.clear()
        if not positions:
            table.add_row("[dim]No positions — all cash[/]", "", "", "", "", "")
            return
        for p in positions:
            pnl_col   = color_for(p.get("pnl"))
            pnl_str   = f"[{pnl_col}]{'+' if p['pnl'] >= 0 else ''}{fmt_dollar(p['pnl'])}[/]"
            pct_str   = f"[{pnl_col}]{fmt_pct(p.get('pnlPercent'))}[/]"
            table.add_row(
                f"[bold]{p['symbol']}[/]",
                str(p["shares"]),
                f"${p['avgCost']:.2f}",
                f"[white]${p['currentPrice']:.2f}[/]",
                pnl_str,
                pct_str,
            )

    def _render_market(self, stocks):
        table = self.query_one("#market_table", DataTable)
        table.clear()
        if not stocks:
            table.add_row("[dim]No data — run a cycle to fetch prices[/]", "", "", "", "")
            return
        for s in stocks:
            chg_color = color_for(s.get("changePercent"))
            price_str = f"${s['price']:.2f}" if s.get("price") else "—"
            chg_str   = f"[{chg_color}]{'+' if s.get('changePercent', 0) >= 0 else ''}{s.get('changePercent', 0):.2f}%[/]" if s.get("changePercent") is not None else "—"
            stale_flag = " [dim][stale][/]" if s.get("stale") else ""
            table.add_row(
                f"[bold]{s['symbol']}[/]",
                s["name"],
                price_str + stale_flag,
                chg_str,
                f"[dim]{s['sector']}[/]",
            )

    def _render_trades(self, trades):
        table = self.query_one("#trades_table", DataTable)
        table.clear()
        if not trades:
            table.add_row("[dim]No trades yet[/]", "", "", "", "", "")
            return
        for t in trades:
            action_color = "green" if t["action"] == "BUY" else "red"
            table.add_row(
                t.get("date", "—"),
                f"[bold]{t['symbol']}[/]",
                f"[{action_color}]{t['action']}[/]",
                str(t["shares"]),
                f"${t.get('price', 0):.2f}",
                (t.get("reasoning") or "—")[:60],
            )

    def _render_chart(self, snapshots):
        if snapshots:
            self.query_one("#perf_chart", PerformanceChart).update_chart(snapshots)

    def _set_status(self, text: str):
        self.query_one("#status_bar", Static).update(text)

    # ── Actions ───────────────────────────────────────────────────────────────

    @work(exclusive=False, thread=True)
    def action_trigger_trade(self):
        self.call_from_thread(
            self._set_status, "[yellow]Triggering trading cycle… (this may take ~30s)[/]"
        )
        try:
            with httpx.Client(timeout=120) as client:
                resp = client.post(f"{self.server_url}/api/trading/run")
                result = resp.json()
            trades = result.get("tradesExecuted", 0)
            value  = result.get("portfolioValue", 0)
            self.call_from_thread(
                self._set_status,
                f"[green]Cycle complete[/] — {trades} trade(s) executed · Portfolio: {fmt_dollar(value)}",
            )
            self.call_from_thread(self.action_refresh)
        except Exception as exc:
            self.call_from_thread(
                self._set_status, f"[red]Cycle failed: {exc}[/]"
            )


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="AI Trading Bot TUI Dashboard")
    parser.add_argument(
        "--host",
        default="http://localhost:3000",
        help="URL of the FootballTracker server (default: http://localhost:3000)",
    )
    args = parser.parse_args()

    app = TradingDashboard(host=args.host)
    app.run()


if __name__ == "__main__":
    main()
