import * as k8s from "@kubernetes/client-node";
import * as _ from 'lodash'
import { fstat, readdirSync, readFile, readFileSync } from "fs";
import * as fs from "fs";
import * as YAML from 'yaml';
import * as path from "path";
import { PersistentVolume } from "@pulumi/kubernetes/core/v1";
import * as mkdirp from 'mkdirp'
import * as request from 'request'
import { reject } from "lodash";
import { resolve } from "dns";

export interface Cluster {
    Deployments: [string, k8s.V1Deployment][]
    PersistentVolumeClaims: [string, k8s.V1PersistentVolumeClaim][]
    PersistentVolumes: [string, k8s.V1PersistentVolume][]
    Services: [string, k8s.V1Service][]
    ClusterRoles: [string, k8s.V1ClusterRole][]
    ClusterRoleBindings: [string, k8s.V1ClusterRoleBinding][]
    ConfigMaps: [string, k8s.V1ConfigMap][]
    DaemonSets: [string, k8s.V1DaemonSet][]
    Ingresss: [string, k8s.V1Ingress][]
    PodSecurityPolicys: [string, k8s.V1beta1PodSecurityPolicy][]
    Roles: [string, k8s.V1Role][]
    RoleBindings: [string, k8s.V1RoleBinding][]
    ServiceAccounts: [string, k8s.V1ServiceAccount][]
    Secrets: [string, k8s.V1Secret][]
    StatefulSets: [string, k8s.V1StatefulSet][]
    StorageClasses: [string, k8s.V1StorageClass][]
    RawFiles: [string, string][]
    Unrecognized: string[]
    ManualInstructions: string[]
}

export type Transform = (c: Cluster) => Promise<void>

// Returns a thing that transforms all deployments that match a particular criteria
export const transformDeployments = (selector: (d: k8s.V1Deployment) => boolean, transform: (d: k8s.V1Deployment) => void): Transform => {
    return ((c: Cluster) => {
        c.Deployments.filter(([, d]) => selector(d)).forEach(([, d]) => transform(d))
        return Promise.resolve()
    })
}

export const setResources = (containerNames: string[], resources: k8s.V1ResourceRequirements): Transform => (c: Cluster) => {
    const updateContainer = (c: k8s.V1Container) => {
        c.resources || (c.resources = {})
        _.merge(c.resources, resources)
    }
    const containers = [
        ..._.flatten(c.Deployments.map(([, d]) => d.spec?.template.spec?.containers)),
        ..._.flatten(c.StatefulSets.map(([, d]) => d.spec?.template.spec?.containers))
    ]
    containers
        .filter((c?: k8s.V1Container) => c && _.includes(containerNames, c.name))
        .forEach(c => c && updateContainer(c))
    return Promise.resolve()
}

export const setReplicas = (deploymentAndStatefulSetNames: string[], replicas: number): Transform => (c: Cluster) => {
    c.Deployments
        .filter(([, deployment]) => _.includes(deploymentAndStatefulSetNames, deployment.metadata?.name) && deployment.spec)
        .forEach(([, deployment]) => deployment.spec!.replicas = replicas)
    c.StatefulSets
        .filter(([, statefulSet]) => _.includes(deploymentAndStatefulSetNames, statefulSet.metadata?.name) && statefulSet.spec)
        .forEach(([, statefulSet]) => statefulSet.spec!.replicas = replicas)
    return Promise.resolve()
}

export const setNodeSelector = (deploymentAndStatefulSetNames: string[], nodeSelector: { [key: string]: string }): Transform => (c: Cluster) => {
    c.Deployments
        .filter(([, deployment]) => _.includes(deploymentAndStatefulSetNames, deployment.metadata?.name) && deployment.spec?.template.spec)
        .forEach(([, deployment]) =>
            deployment.spec!.template.spec!.nodeSelector = _.merge({}, deployment.spec?.template.spec?.nodeSelector, nodeSelector)
        )
    c.StatefulSets
        .filter(([, statefulSet]) => _.includes(deploymentAndStatefulSetNames, statefulSet.metadata?.name) && statefulSet.spec?.template.spec)
        .forEach(([, statefulSet]) =>
            statefulSet.spec!.template.spec!.nodeSelector = _.merge({}, statefulSet.spec?.template.spec?.nodeSelector, nodeSelector)
        )
    return Promise.resolve()
}

export const setAffinity = (deploymentAndStatefulSetNames: string[], affinity: k8s.V1Affinity): Transform => (c: Cluster) => {
    c.Deployments
        .filter(([, deployment]) => _.includes(deploymentAndStatefulSetNames, deployment.metadata?.name) && deployment.spec?.template.spec)
        .forEach(([, deployment]) =>
            deployment.spec!.template.spec!.affinity = affinity
        )
    c.StatefulSets
        .filter(([, statefulSet]) => _.includes(deploymentAndStatefulSetNames, statefulSet.metadata?.name) && statefulSet.spec?.template.spec)
        .forEach(([, statefulSet]) =>
            statefulSet.spec!.template.spec!.affinity = affinity
        )
    return Promise.resolve()
}

export const setRedis = (redisCacheEndpoint: string, redisStoreEndpoint: string): Transform => (c: Cluster) => {
    c.Deployments.filter(
        ([, deployment]) => _.includes(['sourcegraph-frontend', 'repo-updater'], deployment.metadata?.name)
    ).forEach(
        ([, deployment]) => {
            deployment.spec?.template.spec?.containers.filter(
                container => _.includes(['frontend', 'repo-updater'], container.name)).forEach(container => {
                    if (!container.env) {
                        container.env = []
                    }
                    updateEnvironment(container.env, {
                        REDIS_CACHE_ENDPOINT: redisCacheEndpoint,
                        REDIS_STORE_ENDPOINT: redisStoreEndpoint,
                    })
                }
                )
        }
    )
    return Promise.resolve()
}

export const setPostgres = (postgresEndpoint: {
    PGPORT?: string,
    PGHOST?: string,
    PGUSER?: string,
    PGPASSWORD?: string,
    PGDATABASE?: string,
    PGSSLMODE?: string,
}): Transform => (c: Cluster) => {
    c.Deployments.filter(
        ([, deployment]) => _.includes(['sourcegraph-frontend', 'repo-updater'], deployment.metadata?.name)
    ).forEach(
        ([, deployment]) => {
            deployment.spec?.template.spec?.containers.filter(
                container => _.includes(['frontend', 'repo-updater'], container.name)).forEach(container => {
                    if (!container.env) {
                        container.env = []
                    }
                    updateEnvironment(container.env, postgresEndpoint)
                }
                )
        }
    )
    return Promise.resolve()
}

const updateEnvironment = (curenv: Array<k8s.V1EnvVar>, newenv: { [name: string]: string | undefined }) => {
    for (const key of _.keys(newenv)) {
        if (!newenv[key]) {
            continue
        }
        let foundExisting = false
        for (const curEnvVar of curenv) {
            if (curEnvVar.name === key) {
                curEnvVar.value = newenv[key]
                foundExisting = true
                break
            }
        }
        if (!foundExisting) {
            curenv.push({
                name: key,
                value: newenv[key],
            })
        }
    }
}

export const platform = (base: 'gcp' | 'aws' | 'azure' | 'minikube' | 'generic', customizeStorageClass?: (sc: k8s.V1StorageClass) => void): Transform => (c: Cluster) => {
    const obj = YAML.parse(readFileSync(path.join('custom', `${base}.StorageClass.yaml`)).toString())
    if (customizeStorageClass) {
        customizeStorageClass(obj)
    }
    c.StorageClasses.push(['sourcegraph.StorageClass.yaml', obj])

    if (base === 'minikube') {
        const removeResources = (deployOrSS:k8s.V1Deployment | k8s.V1StatefulSet) => {
            deployOrSS.spec?.template.spec?.containers.forEach(container => delete container['resources'])
        }
        c.Deployments.forEach(([,deployment]) => removeResources(deployment))
        c.StatefulSets.forEach(([,ss]) => removeResources(ss))
    }

    return Promise.resolve()
}

export const ingressNginx = (tls?: { certFile: string, keyFile: string, hostname: string }): Transform => async (c: Cluster) => {
    const body = await new Promise<any>(resolve => request('https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v0.47.0/deploy/static/provider/cloud/deploy.yaml', (err, res, body) => {
        resolve(body)
    }))

    // Add `deploy: sourcegraph` label
    const docs = YAML.parseAllDocuments(body)
    for (const doc of docs) {
        doc.setIn(['metadata', 'labels', 'deploy'], 'sourcegraph')
    }

    if (tls) {
        c.Ingresss.forEach(([filepath, data]) => {
            data.spec!.tls = [{
                hosts: [tls.hostname],
                secretName: 'sourcegraph-tls',
            }]
            data.spec!.rules = [{
                http: {
                    paths: [{
                        path: '/',
                        backend: {
                            service: {
                                name: 'sourcegraph-frontend',
                                port: {
                                    number: 300080
                                }
                            }
                        }
                    }],
                },
                host: tls.hostname,
            }]
        })

        const cert = readFileSync(tls.certFile).toString('base64')
        const key = readFileSync(tls.keyFile).toString('base64')
        c.Secrets.push(['sourcegraph-tls.Secret.yaml', {
            apiVersion: 'v1',
            kind: 'Secret',
            metadata: { name: 'sourcegraph-tls' },
            type: 'kubernetes.io/tls',
            data: {
                'tls.crt': cert,
                'tls.key': key,
            }
        }])

        c.ManualInstructions.push(`Update your [site configuration](https://docs.sourcegraph.com/admin/config/site_config) to set \`externalURL\` to ${tls.hostname}`)
    }

    c.RawFiles.push(['ingress-nginx.yaml', docs.map(doc => doc.toString()).join('\n')])
}

export const serviceNginx = (tlsCertFile: string, tlsKeyFile: string): Transform => async (c: Cluster) => {
    const s = readFileSync(path.join('custom', 'nginx-svc', 'nginx.ConfigMap.yaml')).toString()
    const y = YAML.parse(s) as k8s.V1ConfigMap
    const tlsCert = readFileSync(tlsCertFile).toString()
    const tlsKey = readFileSync(tlsKeyFile).toString()
    y.data!['tls.crt'] = tlsCert
    y.data!['tls.key'] = tlsKey
    c.ConfigMaps.push(['nginx.ConfigMap.yaml', y])
    c.Deployments.push([
        'nginx.Deployment.yaml',
        YAML.parse(readFileSync(path.join('custom', 'nginx-svc', 'nginx.Deployment.yaml')).toString())
    ])
    c.Services.push([
        'nginx.Service.yaml',
        YAML.parse(readFileSync(path.join('custom', 'nginx-svc', 'nginx.Service.yaml')).toString())
    ])
}

export const nodePort = (): Transform => async (c: Cluster) => {
    c.Services.forEach(([filename, service]) => {
        if (filename.endsWith('sourcegraph-frontend.Service.yaml')) {
            service.spec!.type = 'NodePort'
            service.spec!.ports?.forEach(port => {
                if (port.name === 'http') {
                    port.nodePort = port.port
                }
            })
        }
    })
    c.ManualInstructions.push(`You've configured sourcegraph-frontend to be a NodePort service. This requires exposing a port on your cluster machines to the Internet.

If you are updating an existing service, you may need to delete the old service first:

  kubectl delete svc sourcegraph-frontend
  kubectl apply --prune -l deploy=sourcegraph -f .

Google Cloud Platform
=====================

  # Expose the necessary ports.
  gcloud compute --project=$PROJECT firewall-rules create sourcegraph-frontend-http --direction=INGRESS --priority=1000 --network=default --action=ALLOW --rules=tcp:30080

  # Find a node name
  kubectl get pods -l app=sourcegraph-frontend -o=custom-columns=NODE:.spec.nodeName

  # Get the EXTERNAL-IP address (will be ephemeral unless you
  # [make it static](https://cloud.google.com/compute/docs/ip-addresses/reserve-static-external-ip-address#promote_ephemeral_ip)
  kubectl get node $NODE -o wide

AWS
===

Update the [AWS Security Group rules](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_SecurityGroups.html) for the nodes in your cluster to expose the NodePort port.

Afterward, Sourcegraph should be accessible at $EXTERNAL_ADDR:30080, where $EXTERNAL_ADDR is the address of any node in the cluster.

Other cloud providers
=====================

Follow your cloud provider documentation to expose the NodePort port on the cluster VMs to the Internet.
`)
}

export const sshCloning = (sshKeyFile: string, knownHostsFile: string, root: boolean = true): Transform => async (c: Cluster) => {
    const sshKey = readFileSync(sshKeyFile).toString('base64')
    const knownHosts = readFileSync(knownHostsFile).toString('base64')
    const sshDir = root ? '/root' : '/home/sourcegraph'
    c.Secrets.push(['gitserver-ssh.Secret.yaml', {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name: 'gitserver-ssh' },
        type: 'Opaque',
        data: {
            id_rsa: sshKey,
            known_hosts: knownHosts,
        }
    }])
    c.StatefulSets.filter(([filename,]) => filename.endsWith('gitserver.StatefulSet.yaml')).forEach(([filename, data]) => {
        data.spec!.template.spec!.containers.forEach(container => {
            if (container.name === 'gitserver') {
                if (!container.volumeMounts) {
                    container.volumeMounts = []
                }
                container.volumeMounts.push({ mountPath: `${sshDir}/.ssh`, name: 'ssh' })
            }
        })
        if (!data.spec!.template.spec!.volumes) {
            data.spec!.template.spec!.volumes = []
        }
        !data.spec!.template.spec!.volumes!.push({ name: 'ssh', secret: { defaultMode: 0o644, secretName: 'gitserver-ssh' } })
    })
}

// TODO: change non-root to be the default, and runAsRoot to be an option
export const nonRoot = (): Transform => async (c: Cluster) => {
    const runAsUserAndGroup: {
        [name: string]: {
            runAsUser?: number,
            runAsGroup?: number,
            containers?: {
                [containerName: string]: {
                    runAsUser?: number,
                    runAsGroup?: number,
                }
            }
        }
    } = {
        'codeinsights-db': {
            runAsUser: 70,
            containers: {
                timescaledb: {
                    runAsGroup: 70,
                    runAsUser: 70,
                }
            }
        },
        'codeintel-db': {
            runAsGroup: 999,
            runAsUser: 999,
        },
        'grafana': {
            containers: {
                grafana: {
                    runAsUser: 472,
                    runAsGroup: 472,
                }
            }
        },
        'pgsql': {
            runAsGroup: 999,
            runAsUser: 999,
        },
        'redis-cache': {
            runAsUser: 999,
            runAsGroup: 1000,
        },
        'redis-store': {
            runAsUser: 999,
            runAsGroup: 1000,
        }
    }
    const update = (deployOrSS: k8s.V1Deployment | k8s.V1StatefulSet) => {
        if (!deployOrSS.metadata?.name) {
            return
        }
        if (runAsUserAndGroup[deployOrSS.metadata.name]) {
            _.merge(deployOrSS, {
                spec: {
                    template: {
                        spec: {
                            securityContext: _.omitBy({
                                runAsUser: runAsUserAndGroup[deployOrSS.metadata.name].runAsUser,
                                runAsGroup: runAsUserAndGroup[deployOrSS.metadata.name].runAsGroup,
                            }, _.isUndefined),
                        }
                    }
                }
            })
        }
        deployOrSS.spec?.template.spec?.containers.forEach(container => {
            const containerSecurityContext = {
                allowPrivilegeEscalation: false,
                runAsUser: 100,
                runAsGroup: 101,
            }
            if (deployOrSS.metadata?.name) {
                const containers = runAsUserAndGroup[deployOrSS.metadata.name]?.containers
                _.merge(
                    containerSecurityContext,
                    _.omit(runAsUserAndGroup[deployOrSS.metadata.name], 'containers'),
                    containers && containers[container.name],
                )
            }
            container.securityContext = containerSecurityContext
        })
    }
    c.Deployments.forEach(([, deployOrSS]) => update(deployOrSS))
    c.StatefulSets.forEach(([, deployOrSS]) => update(deployOrSS))
    return Promise.resolve()
}

export const nonPrivileged = (): Transform => async (c: Cluster) => { 
    await nonRoot()(c) // implies non-root for now

    // NEXT: remove non-privileged changes

    return Promise.resolve()
}