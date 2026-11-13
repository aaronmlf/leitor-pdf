// Evita a janela de console piscando no Windows em build release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::webview::DownloadEvent;
use tauri::{Url, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let window = &app.config().app.windows[0];
            let dev_url = app.config().build.dev_url.clone();
            WebviewWindowBuilder::from_config(app, window)?
                .on_download(move |webview, event| match event {
                    DownloadEvent::Requested { url, destination } => {
                        let is_backup = destination
                            .file_name()
                            .and_then(|name| name.to_str())
                            .is_some_and(|name| {
                                name.starts_with("leitor-biblioteca-") && name.ends_with(".zip")
                            });
                        is_backup
                            && webview.url().is_ok_and(|page| {
                                is_local_backup_url(&url, &page, dev_url.as_ref())
                            })
                    }
                    _ => true,
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Leitor");
}

fn is_local_backup_url(url: &Url, page: &Url, dev_url: Option<&Url>) -> bool {
    let is_app_page = matches!(
        (page.scheme(), page.host_str()),
        ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
    );
    let is_dev_page =
        cfg!(debug_assertions) && dev_url.is_some_and(|dev| dev.origin() == page.origin());
    if !(is_app_page || is_dev_page) || url.scheme() != "blob" {
        return false;
    }

    Url::parse(url.path()).is_ok_and(|source| {
        source.scheme() == page.scheme()
            && source.host_str() == page.host_str()
            && source.port_or_known_default() == page.port_or_known_default()
    })
}
