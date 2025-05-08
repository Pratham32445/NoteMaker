import { Meeting } from "./Meeting";
import app from "./server";

function startProcess() {

    const SLUG = process.env.SLUG;
    const MEETING_ID = process.env.MEETING_ID;
    if (!SLUG || !MEETING_ID) {
        console.log("slug and meeting id is a required field");
        process.exit(0);
    }

    console.log(SLUG,"slug is found");

    const newMeeting = new Meeting(process.env.MEETING_ID!);

    app.post(`/${SLUG}/meeting/pause`, async (req, res) => {
        await newMeeting.pauseRecording();
        res.send("Paused");
    })

    app.post(`/${SLUG}/meeting/resume`, async (req, res) => {
        await newMeeting.resumeRecording();
        res.send("Resume");
    })

    app.listen(3000, async () => {
        console.log("server started");
        await newMeeting.joinMeeting();
        console.log("meeting finished");
        process.exit(0);
    })
}


startProcess();