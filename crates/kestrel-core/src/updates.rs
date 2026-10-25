//! Update discovery against the public GitHub release feed.
//!
//! Kestrel only *notifies* about a newer release. Installing it stays an explicit
//! user action on the release page; there is no silent update loop.

use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use semver::Version;
use serde::{Deserialize, Serialize};
use url::Url;

const RELEASES_URL: &str = "https://api.github.com/repos/Shinjiru-stack/kestrel/releases/latest";
const RELEASE_PAGE_PREFIX: &str = "/Shinjiru-stack/kestrel/releases/";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAsset {
    pub name: String,
    pub url: String,
    pub size: u64,
    pub content_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub tag_name: String,
    pub name: String,
    pub url: String,
    pub notes: String,
    pub published_at: String,
    pub assets: Vec<UpdateAsset>,
}

#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    html_url: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    content_type: String,
}

/// Check the latest public release and return it only when it is newer than
/// `current_version`. A `None` result means the app is current.
pub async fn check(current_version: &str) -> Result<Option<UpdateInfo>> {
    let current = parse_version(current_version)
        .with_context(|| format!("invalid current version {current_version:?}"))?;
    let release = fetch_latest(current_version).await?;
    let latest = parse_version(&release.tag_name)
        .with_context(|| format!("latest release tag {:?} is not semver", release.tag_name))?;

    if latest <= current {
        return Ok(None);
    }

    validate_release_url(&release.html_url)?;
    let assets = release
        .assets
        .into_iter()
        .filter(|asset| is_github_url(&asset.browser_download_url))
        .map(|asset| UpdateAsset {
            name: asset.name,
            url: asset.browser_download_url,
            size: asset.size,
            content_type: asset.content_type,
        })
        .collect();

    Ok(Some(UpdateInfo {
        current_version: current.to_string(),
        latest_version: latest.to_string(),
        tag_name: release.tag_name,
        name: release.name.unwrap_or_default(),
        url: release.html_url,
        notes: release
            .body
            .unwrap_or_default()
            .chars()
            .take(12_000)
            .collect(),
        published_at: release.published_at.unwrap_or_default(),
        assets,
    }))
}

async fn fetch_latest(current_version: &str) -> Result<Release> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent(format!("Kestrel/{current_version}"))
        .build()
        .context("could not create the update HTTP client")?;

    let response = client
        .get(RELEASES_URL)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .context("could not reach the GitHub release feed")?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let detail = body.trim();
        let detail = detail.chars().take(280).collect::<String>();
        bail!(
            "GitHub release check returned HTTP {status}{}",
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        );
    }

    response
        .json::<Release>()
        .await
        .context("GitHub returned an unreadable release response")
}

fn parse_version(value: &str) -> Result<Version> {
    let value = value.trim();
    let value = value
        .strip_prefix('v')
        .or_else(|| value.strip_prefix('V'))
        .unwrap_or(value);
    Version::parse(value).map_err(|err| anyhow!("{err}"))
}

fn is_github_url(value: &str) -> bool {
    Url::parse(value)
        .map(|url| url.scheme() == "https" && url.host_str() == Some("github.com"))
        .unwrap_or(false)
}

fn validate_release_url(value: &str) -> Result<()> {
    let url = Url::parse(value).context("release URL is invalid")?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.path().starts_with(RELEASE_PAGE_PREFIX)
    {
        bail!("release URL does not point at the Kestrel GitHub release");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_release_tags_with_optional_v() {
        assert_eq!(parse_version("v0.1.1").unwrap(), Version::new(0, 1, 1));
        assert_eq!(parse_version("0.1.1").unwrap(), Version::new(0, 1, 1));
        assert_eq!(
            parse_version("v0.2.0-rc.1").unwrap(),
            Version::parse("0.2.0-rc.1").unwrap()
        );
        assert!(parse_version("nightly").is_err());
    }

    #[test]
    fn compares_release_versions() {
        let current = parse_version("0.1.0").unwrap();
        assert!(parse_version("v0.1.1").unwrap() > current);
        assert!(parse_version("v0.1.0").unwrap() <= current);
        assert!(parse_version("v0.2.0-rc.1").unwrap() > current);
    }

    #[test]
    fn accepts_only_github_release_urls() {
        assert!(
            validate_release_url("https://github.com/Shinjiru-stack/kestrel/releases/tag/v0.1.1")
                .is_ok()
        );
        assert!(
            validate_release_url("https://example.com/Shinjiru-stack/kestrel/releases/tag/v0.1.1")
                .is_err()
        );
        assert!(
            validate_release_url("http://github.com/Shinjiru-stack/kestrel/releases/tag/v0.1.1")
                .is_err()
        );
    }
}
