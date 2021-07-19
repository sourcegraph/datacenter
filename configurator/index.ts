import * as k8s from "@kubernetes/client-node";
import { fstat, readdirSync, readFile, readFileSync } from "fs";
import * as fs from "fs";
import * as YAML from 'yaml';
import * as path from "path";
import { PersistentVolume } from "@pulumi/kubernetes/core/v1";
import * as mkdirp from 'mkdirp'
import { Cluster } from './common'
import { transformations } from './customize'

(async function() {
    const sourceDir = '../base'
    const outDir = 'rendered'
    
    const cluster: Cluster = {
        Deployments: [],
        PersistentVolumeClaims: [],
        PersistentVolumes: [],
        Services: [],
        ClusterRoles: [],
        ClusterRoleBindings: [],
        ConfigMaps: [],
        DaemonSets: [],
        Ingresss: [],
        PodSecurityPolicys: [],
        Roles: [],
        RoleBindings: [],
        Secrets: [],
        ServiceAccounts: [],
        StatefulSets: [],
        StorageClasses: [],
        RawFiles: [],
        Unrecognized: [],
        ManualInstructions: [],
    }

    function readCluster(root: string) {
        const contents = readdirSync(root, {withFileTypes: true})
        for (const entry of contents) {
            if (entry.isFile()) {
                if (entry.name.endsWith('.yaml')) {
                    const k8sType = path.extname(entry.name.substring(0, entry.name.length - '.yaml'.length))
                    const filename = path.join(root, entry.name)
                    const relativeFilename = path.relative(sourceDir, filename)
                    switch (k8sType) {
                        case '.Deployment':
                            cluster.Deployments.push([relativeFilename, YAML.parse(readFileSync(filename).toString())])
                            break
                        case '.PersistentVolumeClaim':
                            cluster.PersistentVolumeClaims.push([relativeFilename, YAML.parse(readFileSync(filename).toString())])
                            break
                        case '.PersistentVolume':
                            cluster.PersistentVolumes.push([relativeFilename, YAML.parse(readFileSync(filename).toString())])
                            break
                        case '.Service':
                        case '.IndexerService':
                            cluster.Services.push([relativeFilename, YAML.parse(readFileSync(filename).toString())])
                            break
                        case '.ClusterRole':
                            cluster.ClusterRoles.push([relativeFilename, YAML.parse(readFileSync(filename).toString())])
                            break
                        case '.ClusterRoleBinding':
                            cluster.ClusterRoleBindings.push([relativeFilename, YAML.parse(readFileSync(filename).toString())])
                            break
                        case '.ConfigMap':
                            cluster.ConfigMaps.push([relativeFilename, YAML.parse(readFileSync(filename).toString())])
                            break
                        case '.DaemonSet':
                            cluster.DaemonSets.push([relativeFilename, YAML.parse(readFileSync(filename).toString())])
                            break
                        case '.Ingress':
                            cluster.Ingresss.push([relativeFilename, YAML.parse(readFileSync(filename).toString())])
                            break
                        case '.PodSecurityPolicy':
                            cluster.PodSecurityPolicys.push([relativeFilename, YAML.parse(readFileSync(filename).toString())])
                            break
                        case '.Role':
                            cluster.Roles.push([relativeFilename, YAML.parse(readFileSync(filename).toString())])
                            break
                        case '.RoleBinding':
                            cluster.RoleBindings.push([relativeFilename, YAML.parse(readFileSync(filename).toString())])
                            break
                        case '.ServiceAccount':
                            cluster.ServiceAccounts.push([relativeFilename, YAML.parse(readFileSync(filename).toString())])
                            break
                        case '.StatefulSet':
                            cluster.StatefulSets.push([relativeFilename, YAML.parse(readFileSync(filename).toString())])
                            break
                        default:
                            cluster.Unrecognized.push(entry.name)
                    }
                }
            } else if (entry.isDirectory()) {
                readCluster(path.join(root, entry.name))
            } else {
                console.error("Ignoring unrecognized file type, name: ", entry.name)
            }
        }    
    }    
    readCluster(sourceDir)
    
    for (const t of transformations) {
        await t(cluster)
    }
    
    async function writeCluster(c: Cluster) {
        const fileContents = []
        fileContents.push(
            ...c.Deployments,
            ...c.PersistentVolumeClaims,
            ...c.PersistentVolumes,
            ...c.Services,
            ...c.ClusterRoles,
            ...c.ClusterRoleBindings,
            ...c.ConfigMaps,
            ...c.DaemonSets,
            ...c.Ingresss,
            ...c.PodSecurityPolicys,
            ...c.Roles,
            ...c.RoleBindings,
            ...c.ServiceAccounts,
            ...c.StatefulSets,
            ...c.StorageClasses,
            ...c.Secrets,
        )
        await Promise.all(fileContents.map(async c => {
            const filename = path.join(outDir, c[0])
            const directory = path.dirname(filename)
            await mkdirp(directory)
            fs.writeFileSync(filename, YAML.stringify(c[1]))
        }))
        for (const [name, contents] of c.RawFiles) {
            fs.writeFileSync(path.join(outDir, name), contents)
        }

        if (c.ManualInstructions.length > 0) {
            console.log("####################\n# Additional steps #\n####################\n")

            for (const instruction of c.ManualInstructions) {
                console.log(instruction + '\n\n\n')
            }
        }
    }

    await writeCluster(cluster)
})().then(() => {
    console.log("Done")
})
