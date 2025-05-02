import express from "express"
import { AppsV1Api, CoreV1Api, KubeConfig } from "@kubernetes/client-node"
import { V1Deployment, V1Service } from "@kubernetes/client-node";
import path from "path";
import yaml from "yaml";
import fs from "fs";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const app = express();
app.use(express.json());


const kubeConfig = new KubeConfig();
kubeConfig.loadFromDefault();

const coreV1Api = kubeConfig.makeApiClient(CoreV1Api);
const appsV1Api = kubeConfig.makeApiClient(AppsV1Api);

function readAndParseYaml(filePath: string, meeting_id: string, duration: number): { deployment: V1Deployment, service: V1Service } {
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const docs = yaml.parseAllDocuments(fileContent);
    let deployment: V1Deployment | null = null;
    let service: V1Service | null = null;
    docs.forEach((doc) => {
        const obj = doc.toJSON();
        if (obj.kind === "Deployment") {
            obj.spec.template.spec.containers[0].env.forEach((envVar: any) => {
                if (envVar.name === "MEETING_ID") envVar.value = meeting_id;
                if (envVar.name === "DURATION") envVar.value = duration;
            });
            deployment = obj;
        } else if (obj.kind === "Service") {
            service = obj;
        }
    })
    if (!deployment || !service) {
        throw new Error("YAML did not contain both Deployment and Service");
    }
    return { deployment, service };
}


app.post("/new-meeting", async (req, res) => {
    const { meeting_id, duration } = req.body;
    if (!meeting_id || !duration) {
        return res.status(400).json({ message: "Missing meeting_id or duration" });
    }
    const namespace = "default";
    const deploymentName = `fathom-bot-${meeting_id}`;
    const serviceName = `fathom-bot-service-${meeting_id}`;
    const appLabel = `fathom-bot-${meeting_id}`;

    try {
        // Read YAML and inject unique names and labels
        const { deployment, service } = readAndParseYaml(
            path.join(__dirname, "./k8s/deployment.yaml"),
            meeting_id,
            duration
        );
        console.log(deployment, service);
        if (!deployment || !service) return res.status(401).json({ message: "not allowed" });

        // Update names and labels for uniqueness
        deployment.metadata!.name = deploymentName;
        deployment.spec!.selector!.matchLabels!.app = appLabel;
        deployment.spec!.template!.metadata!.labels!.app = appLabel;
        service.metadata!.name! = serviceName;
        service.spec!.selector!.app = appLabel;

        // Create resources
        await appsV1Api.createNamespacedDeployment({ namespace, body: deployment });
        await coreV1Api.createNamespacedService({ namespace, body: service });
        res.status(201).json({ message: "Meeting started", deploymentName, serviceName });
    } catch (error: any) {
        console.log(error);
        res.status(500).json({ message: "Some error occurred", error: error.message });
    }
})

app.listen(3000);