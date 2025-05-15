use std::io;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use anyhow::{Result, Context};
use clap::{Parser, Subcommand};
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use tui::{
    backend::{Backend, CrosstermBackend},
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    widgets::{Block, Borders, Cell, Row, Table, Paragraph},
    Frame, Terminal,
};
use chrono::Local;

use crate::config::AppConfig;
use crate::trader::TokenPosition;

#[derive(Parser)]
#[command(name = "solana-pumpfun-sniper")]
#[command(about = "A Solana Pump.fun sniper bot")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Start the sniper bot
    Start,
    
    /// Show wallet information
    Wallet,
}

// Start the TUI (Terminal User Interface)
pub async fn start_ui(
    app_config: Arc<AppConfig>,
    active_tokens: Arc<Mutex<Vec<TokenPosition>>>,
) -> Result<()> {
    // Set up terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    
    // Create app state
    let app = AppState {
        app_config,
        active_tokens,
        should_quit: false,
    };
    
    // Run the main loop
    let res = run_app(&mut terminal, app).await;
    
    // Restore terminal
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;
    
    if let Err(err) = res {
        println!("Error: {}", err);
    }
    
    Ok(())
}

struct AppState {
    app_config: Arc<AppConfig>,
    active_tokens: Arc<Mutex<Vec<TokenPosition>>>,
    should_quit: bool,
}

async fn run_app<B: Backend>(
    terminal: &mut Terminal<B>,
    mut app: AppState,
) -> Result<()> {
    loop {
        terminal.draw(|f| ui(f, &app))?;
        
        if event::poll(Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Char('q') => {
                        app.should_quit = true;
                    }
                    _ => {}
                }
            }
        }
        
        if app.should_quit {
            break;
        }
    }
    
    Ok(())
}

fn ui<B: Backend>(f: &mut Frame<B>, app: &AppState) {
    // Create layout
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .margin(2)
        .constraints(
            [
                Constraint::Length(3),  // Header
                Constraint::Min(10),    // Token table
                Constraint::Length(3),  // Footer
            ]
            .as_ref(),
        )
        .split(f.size());
    
    // Header
    let header = Paragraph::new(format!(
        "Solana Pump.fun Sniper - Wallet: {} - Press 'q' to quit",
        app.app_config.keypair.pubkey()
    ))
    .style(Style::default().fg(Color::Cyan))
    .block(Block::default().borders(Borders::ALL));
    f.render_widget(header, chunks[0]);
    
    // Create token table
    let token_table = match tokio::task::block_in_place(|| {
        tokio::runtime::Handle::current().block_on(async {
            let tokens = app.active_tokens.lock().await;
            create_token_table(&tokens)
        })
    }) {
        Ok(table) => table,
        Err(_) => {
            // Fallback if we can't get the lock
            let empty_tokens: Vec<TokenPosition> = Vec::new();
            create_token_table(&empty_tokens)
        }
    };
    
    f.render_widget(token_table, chunks[1]);
    
    // Footer with instructions
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let footer = Paragraph::new(format!("Last updated: {}", now))
        .style(Style::default().fg(Color::Gray))
        .block(Block::default().borders(Borders::ALL));
    f.render_widget(footer, chunks[2]);
}

fn create_token_table<'a>(tokens: &[TokenPosition]) -> Table<'a> {
    let header_cells = ["Token", "Buy Price", "Current", "Change", "Buy Time", "Status"]
        .iter()
        .map(|h| Cell::from(*h).style(Style::default().fg(Color::Yellow)));
    
    let header = Row::new(header_cells)
        .style(Style::default())
        .height(1);
    
    let rows = tokens.iter().map(|token| {
        let price_change = (token.current_price / token.buy_price - 1.0) * 100.0;
        let change_color = if price_change >= 0.0 { Color::Green } else { Color::Red };
        
        let cells = [
            Cell::from(format!("{} ({})", token.name, token.symbol)),
            Cell::from(format!("{:.6} SOL", token.buy_price)),
            Cell::from(format!("{:.6} SOL", token.current_price)),
            Cell::from(format!("{:.2}%", price_change)).style(Style::default().fg(change_color)),
            Cell::from(token.buy_time.format("%H:%M:%S").to_string()),
            Cell::from(token.status.clone()),
        ];
        
        Row::new(cells).height(1)
    });
    
    Table::new(rows)
        .header(header)
        .block(Block::default().title("Active Tokens").borders(Borders::ALL))
        .highlight_style(Style::default().add_modifier(Modifier::BOLD))
        .widths(&[
            Constraint::Percentage(25),
            Constraint::Percentage(15),
            Constraint::Percentage(15),
            Constraint::Percentage(15),
            Constraint::Percentage(15),
            Constraint::Percentage(15),
        ])
}
