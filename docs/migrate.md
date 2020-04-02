# Migrations

This document records manual migrations that are necessary to apply when upgrading to certain
Sourcegraph versions. All manual migrations between the version you are upgrading from and the
version you are upgrading to should be applied (unless otherwise noted).

## 3.15

### (optional) Keep LSIF data through manual migration

If you have previously uploaded LSIF precise code intelligence data and wish to retain it after upgrading, you will need to perform this migration.

**Skipping the migration**

If you choose not to migrate the data, Sourcegraph will use basic code intelligence until you upload LSIF data again.

You may run the following commands to remove the now unused resources:

```shell script
kubectl delete svc lsif-server
kubectl delete deployment lsif-server
kubectl delete pvc lsif-server
```

**Migrating**

The lsif-server service has been replaced by a trio of services defined in [precise-code-intel](../base/precise-code-intel),
and the persistent volume claim in which lsif-server  stored converted LSIF uploads has been replaced by
[bundle storage](../base/precise-code-intel/bundle-storage.PersistentVolume.yaml).

Upgrading to 3.15 will create a new empty volume for LSIF data. Without any action, the LSIF data previously uploaded
to the instance will be lost. To retain old LSIF data, perform the following migration steps. This will cause some
temporary downtime for precise code intelligence.

**Migrating**

1. Deploy 3.15. This will create a `bundle-manager` persistent volume claim.
2. Release the claims to old and new persistent volumes by taking down `lsif-server` and `precise-code-intel-bundle-manager`.

```shell script
kubectl delete svc lsif-server
kubectl delete deployment lsif-server
kubectl delete deployment precise-code-intel-bundle-manager
```

3. Deploy the `lsif-server-migrator` deployment to transfer the data from the old volume to the new volume.

```shell script
kubectl apply -f configure/lsif-server-migrator/lsif-server-migrator.Deployment.yaml
```

4. Watch the output of the `lsif-server-migrator` until the copy completes (`'Copy complete!'`).

```shell script
kubectl logs lsif-server-migrator
```

5. Tear down the deployment and re-create the bundle manager deployment.

```shell script
kubectl delete deployment lsif-server-migrator
./kubectl-apply-all.sh
```

6. Remove the old persistent volume claim.

```shell script
kubectl delete pvc lsif-server
```

## 3.14

### Existing installations: Migrating the container user from root to non-root

Version 3.14 changes the security context of the installation by switching to a non-root user for all containers.
This allows running Sourcegraph in clusters with restrictive security policies.

Existing installations that have been run as root before need to migrate their persistent volumes to work in 3.14.
We are providing a [kustomization](https://kustomize.io/) that needs to be run once to execute the migration:

> NOTE: This needs kubectl client version >= 1.14. If you don't have that you can still install the kustomize
> binary and generate the yaml file with it and then apply it with -f.

```shell script
cd overlays/migrate-to-nonroot
kubectl apply -k .
```

> NOTE: This needs kubectl client version >= 1.14. If you don't have that you can still install the kustomize
> binary and generate the yaml file with it and then apply it with -f like so:

```shell script
cd overlays/migrate-to-nonroot
kustomize build -o nonroot-migration.yaml
kubectl apply -f nonroot-migration.yaml
```

This will inject `initContainers` that do the `chown` command for containers that have persistent volumes and then 
restart the necessary containers.

> NOTE: The migration still needs the elevated permissions because it needs to run as user root.

New installations do not need this `kustomization` and existing installations can operate from base again after the
migration.

### New installations: accommodate clusters with restrictive security policies

New installations on clusters with restrictive security policies can now use a kustomization to accomodate those restrictions:

```shell script
cd overlays/non-privileged
kubectl -n ns-sourcegraph apply -l deploy=sourcegraph,rbac-admin!=escalated -k .
```

The only requirement for the installer is `admin` cluster role in a given namespace.

> IMPORTANT NOTE: If you change the namespace please change all three occurences in this directory tree to the new value. 

## 3.11

In 3.11 we removed the management console. If you make use of `CRITICAL_CONFIG_FILE` or `SITE_CONFIG_FILE`, please refer to the [migration notes for Sourcegraph 3.11+](https://docs.sourcegraph.com/admin/migration/3_11).

## 3.10

In 3.9 we migrated `indexed-search` to a StatefulSet. However, we didn't migrate the `indexed-search` service to a headless service. You can't mutate a service, so you will need to replace the service before running `kubectl-apply-all.sh`:

``` bash
# Replace since we can't mutate services
kubectl replace --force -f base/indexed-search/indexed-search.Service.yaml

# Now apply all so frontend knows how to speak to the new service address
# for indexed-search
./kubectl-apply-all.sh
```

## 3.9

In 3.9 `indexed-search` is migrated from a Kubernetes [Deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) to a [StatefulSet](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/). By default Kubernetes will assign a new volume to `indexed-search`, leading to it being unavailable while it reindexes. To avoid that we need to update the [PersistentVolume](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)'s claim to the new indexed-search pod (from `indexed-search` to `data-indexed-search-0`. This can be achieved by running the commands in the script below before upgrading. Please read the script closely to understand what it does before following it.

``` bash
# Set the reclaim policy to retain so when we delete the volume claim the volume is not deleted.
kubectl patch pv -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}' $(kubectl get pv -o json | jq -r '.items[] | select(.spec.claimRef.name == "indexed-search").metadata.name') 

# Stop indexed search so we can migrate it. This means indexed search will be down!
kubectl scale deploy/indexed-search --replicas=0

# Remove the existing claim on the volume
kubectl delete pvc indexed-search

# Move the claim to data-indexed-search-0, which is the name created by stateful set.
kubectl patch pv -p '{"spec":{"claimRef":{"name":"data-indexed-search-0","uuid":null}}}' $(kubectl get pv -o json | jq -r '.items[] | select(.spec.claimRef.name == "indexed-search").metadata.name') 

# Create the stateful set
kubectl apply -f base/indexed-search/indexed-search.StatefulSet.yaml
```

## 3.8

If you're deploying Sourcegraph into a non-default namespace, refer to ["Use non-default namespace" in docs/configure.md](configure.md#use-non-default-namespace) for further configuration instructions.

## 3.7.2

Before upgrading or downgrading 3.7, please consult the [v3.7.2 migration guide](https://docs.sourcegraph.com/admin/migration/3_7) to ensure you have enough free disk space.

## 3.0

🚨 If you have not migrated off of helm yet, please refer to [docs/helm.migrate.md](helm.migrate.md) before reading the following notes for migrating to Sourcegraph 3.0.

🚨 Please upgrade your Sourcegraph instance to 2.13.x before reading the following notes for migrating to Sourcegraph 3.0.

### Configuration

In Sourcegraph 3.0 all site configuration has been moved out of the `config-file.ConfigMap.yaml` and into the PostgreSQL database. We have an automatic migration if you use version 3.2 or before. Please do not upgrade directly from 2.x to 3.3 or higher.

After running 3.0, you should visit the configuration page (`/site-admin/configuration`) and [the management console](https://docs.sourcegraph.com/admin/management_console) and ensure that your configuration is as expected. In some rare cases, automatic migration may not be able to properly carry over some settings and you may need to reconfigure them.

### `sourcegraph-frontend` service type 

The type of the `sourcegraph-frontend` service ([base/frontend/sourcegraph-frontend.Service.yaml](../base/frontend/sourcegraph-frontend.Service.yaml)) has changed
from `NodePort` to `ClusterIP`. Directly applying this change [will
fail](https://github.com/kubernetes/kubernetes/issues/42282). Instead, you must delete the old
service and then create the new one (this will result in a few seconds of downtime):

```shell
kubectl delete svc sourcegraph-frontend
kubectl apply -f base/frontend/sourcegraph-frontend.Service.yaml
```

### Language server deployment

Sourcegraph 3.0 removed lsp-proxy and automatic language server deployment in favor of [Sourcegraph extensions](https://docs.sourcegraph.com/extensions). As a consequence, Sourcegraph 3.0 does not automatically run or manage language servers. If you had code intelligence enabled in 2.x, you will need to follow the instructions for each language extension and deploy them individually. Read the [code intelligence documentation](https://docs.sourcegraph.com/user/code_intelligence).

### HTTPS / TLS

Sourcegraph 3.0 removed HTTPS / TLS features from Sourcegraph in favor of relying on [Kubernetes Ingress Resources](https://kubernetes.io/docs/concepts/services-networking/ingress/). As a consequence, Sourcegraph 3.0 does not expose TLS as the NodePort 30433. Instead you need to ensure you have setup and configured either an ingress controller (recommended) or an explicit NGINX service. See [ingress controller documentation](configure.md#ingress-controller-recommended), [NGINX service documentation](configure.md#nginx-service), and [configure TLS/SSL documentation](configure.md#configure-tlsssl).

If you previously configured `TLS_KEY` and `TLS_CERT` environment variables, you can remove them from [base/frontend/sourcegraph-frontend.Deployment.yaml](../base/frontend/sourcegraph-frontend.Deployment.yaml)

### Postgres 11.1

Sourcegraph 3.0 ships with Postgres 11.1. The upgrade procedure is mostly automatic. Please read [this page](https://docs.sourcegraph.com/admin/postgres) for detailed information.

## 2.12

Beginning in version 2.12.0, Sourcegraph's Kubernetes deployment [requires an Enterprise license key](https://about.sourcegraph.com/pricing). Follow the steps in [docs/configure.md](docs/configure.md#add-a-license-key).
