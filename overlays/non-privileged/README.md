This kustomization is for Sourcegraph installations in clusters with security restrictions.
It avoids creating `Roles` and does all the rolebinding in a namespace. It configures Prometheus to work in the namespace
and not require ClusterRole wide privileges when doing service discovery for scraping targets.

> Note: To create a fresh installation use `non-privileged-create-cluster` first and then use this overlay.

To use it, execute the following command from the root directory of this repository:

```shell script
./overlay-generate-cluster.sh non-root generated-cluster
```

After executing the script you can apply the generated manifests from the `generated-cluster` directory:

```shell script
kubectl apply -n ns-sourcegraph --prune -l deploy=sourcegraph -f generated-cluster --recursive
```
