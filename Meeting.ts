import { Builder, Browser, By, until, WebDriver } from 'selenium-webdriver';
import { Options } from "selenium-webdriver/chrome";
import { spawn } from "child_process";
import { saveToS3 } from './aws/storeToS3';

export class Meeting {
    meetingId: string;
    driver: WebDriver | null;
    duration: number;
    static ffmpegProcesses: { [meetingId: string]: any } = {};

    constructor(meetingId: string) {
        this.meetingId = meetingId;
        this.driver = null;
        this.duration = (Number(process.env.DURATION) || 1) * 60 * 1000;
    }

    async joinMeeting() {
        try {
            console.log("Connecting to Google Meet...");
            await this.startMeet();
            await new Promise((resolve) => setTimeout(resolve, 10000));
            this.monitorMeetingLive();
            await this.startRecording();
            await new Promise((resolve) => setTimeout(resolve, this.duration));
            await this.stopRecording();
        } catch (error) {
            console.error("Error in joinMeeting:", error);
        }
    }

    async getDriver() {
        const options = new Options();
        options.addArguments(
            "--disable-blink-features=AutomationControlled",
            "--use-fake-ui-for-media-stream",
            "--window-size=1280,720",
            "--auto-select-desktop-capture-source=[RECORD]",
            "--no-sandbox",
            "--disable-popup-blocking",
            "--disable-notifications",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-infobars",
        );

        options.setUserPreferences({
            "profile.default_content_setting_values.notifications": 2,
            "profile.default_content_setting_values.media_stream_mic": 1,
            "profile.default_content_setting_values.media_stream_camera": 1,
            "profile.default_content_setting_values.geolocation": 2,
            "profile.default_content_setting_values.automatic_downloads": 1
        });

        const seleniumUrl = "http://localhost:4444/wd/hub";
        console.log("Connecting to Selenium at:", seleniumUrl);

        return await new Builder()
            .forBrowser(Browser.CHROME)
            .setChromeOptions(options)
            .usingServer(seleniumUrl)
            .build();
    }

    async startRecording() {
        const outputFile = `/app/recordings/meet_recording_${this.meetingId}.mp4`;
        const ffmpegArgs = [
            "-y",
            "-video_size", "1280x720",
            "-framerate", "30",
            "-f", "x11grab",
            "-i", ":99.0",
            "-f", "pulse",
            "-i", "default",
            "-c:v", "libx264",
            "-preset", "faster",
            "-tune", "film",
            "-crf", "23",
            "-g", "60",
            "-profile:v", "main",
            "-movflags", "+faststart",
            "-c:a", "aac",
            "-b:a", "192k",
            "-ar", "48000",
            "-ac", "2",
            "-threads", "4",
            "-flush_packets", "1",
            "-vf", "format=yuv420p",
            outputFile
        ];
        console.log(`[${this.meetingId}] Starting ffmpeg recording: ${ffmpegArgs.join(" ")}`);
        const ffmpegProcess = spawn("ffmpeg", ffmpegArgs, { stdio: "inherit" });
        Meeting.ffmpegProcesses[this.meetingId] = ffmpegProcess;
    }

    async stopRecording() {
        const process = Meeting.ffmpegProcesses[this.meetingId];
        if (process) {
            process.kill("SIGINT");
            await new Promise((resolve) => {
                process.on("close", resolve);
            });
            await saveToS3(this.meetingId);
            if (this.driver) {
                await this.driver.quit();
                this.driver = null;
            }
            delete Meeting.ffmpegProcesses[this.meetingId];
        }
    }

    async startMeet() {
        const driver = await this.getDriver();
        this.driver = driver;
        const meetUrl = `https://meet.google.com/${this.meetingId}`;
        console.log("Opening Meet URL:", meetUrl);
        await driver.get(meetUrl);
        await driver.sleep(1000);

        try {
            const popupButton = await driver.wait(
                until.elementLocated(By.xpath('//span[contains(text(), "Got it")]')), 5000
            );
            await popupButton.click();
        } catch { }

        try {
            const nameInput = await driver.wait(
                until.elementLocated(By.xpath('//input[@placeholder="Your name"]')), 5000
            );
            await nameInput.clear();
            await nameInput.sendKeys("Fathom");
            await driver.sleep(1000);
        } catch { }

        try {
            const joinButton = await driver.wait(
                until.elementLocated(By.xpath('//span[contains(text(), "Ask to join") or contains(text(), "Join now")]')),
                6000
            );
            await joinButton.click();
        } catch { }
    }

    async waitForAdmission() {
        try {
            await this.driver!.wait(until.elementLocated(
                By.xpath('//div[@aria-label="Turn off microphone (Ctrl + D)"]')),
                300000
            );
            console.log("Admitted to meeting");
        } catch (error) {
            throw new Error("Admission timeout: Not let into meeting within 5 minutes");
        }
    }
    async isMeetingLive() {
        if (!this.driver) return null;
        try {
            const memberCountElem = await this.driver!.findElement(By.className('uGOf1d'));
            const countText = await memberCountElem.getText();
            return Number(countText);
        } catch (error) {
            console.log(`[${this.meetingId}] Error fetching member count:`, error);
            return null;
        }
    }
    async monitorMeetingLive() {
        while (this.driver) {
            const cnt = await this.isMeetingLive();
            if (cnt != null && cnt == 1) {
                await this.stopRecording(); break;
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}
