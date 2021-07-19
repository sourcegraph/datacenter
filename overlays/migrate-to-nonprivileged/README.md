This kustomization injects initContainers in all pods with persistent volumes to transfer ownership of directories to
specified non-root users. It is used for migrating existing installations to a non-root environment. By default this overlay ensures all resources
stay in the default namespace. If you have used a different namespace, change it in the [kustomization.yaml](./kustomization.yaml)

```shell script
./overlay-generate-cluster.sh migrate-to-nonprivileged generated-cluster
```

After executing the script you can apply the generated manifests from the `generated-cluster` directory:

```shell script
kubectl apply --prune -l deploy=sourcegraph -f generated-cluster --recursive
```

