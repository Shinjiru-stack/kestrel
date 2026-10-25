use std::time::Duration;

use kestrel_core::kube_client::ClusterClient;

#[tokio::main]
async fn main() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let path = std::env::args().nth(1).unwrap_or_else(|| {
        format!(
            "{}/.kube/k3s-healer.yaml",
            std::env::var("USERPROFILE").unwrap_or_default()
        )
    });
    println!("connecting to {path}");
    let connect =
        tokio::time::timeout(Duration::from_secs(20), ClusterClient::connect(&path, "")).await;
    match connect {
        Ok(Ok(client)) => {
            println!(
                "connected: context={} server={}",
                client.context, client.server
            );
            match tokio::time::timeout(Duration::from_secs(30), client.snapshot()).await {
                Ok(Ok(snapshot)) => println!(
                    "snapshot: cluster={} version={} nodes={} pods={} workloads={} events={}",
                    snapshot.cluster.name,
                    snapshot.cluster.version,
                    snapshot.nodes.len(),
                    snapshot.pods.len(),
                    snapshot.workloads.len(),
                    snapshot.events.len()
                ),
                Ok(Err(err)) => println!("snapshot error: {err:#}"),
                Err(_) => println!("snapshot timeout"),
            }
        }
        Ok(Err(err)) => println!("connect error: {err:#}"),
        Err(_) => println!("connect timeout"),
    }
}
