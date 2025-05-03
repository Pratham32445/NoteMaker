import { Builder, Browser, By, until, WebDriver } from 'selenium-webdriver';
import { Options } from "selenium-webdriver/chrome";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { saveToS3 } from './aws/storeToS3';

export class Meeting {
    meetingId: string;
    driver: WebDriver | null;
    duration: number;
    isJoined: boolean;
    isStopped: boolean;
    timerId: NodeJS.Timeout | null;
    static ffmpegProcesses: { [meetingId: string]: any } = {};

    constructor(meetingId: string) {
        this.meetingId = meetingId;
        this.driver = null;
        this.duration = (Number(process.env.DURATION) || 1) * 60 * 1000;
        this.isJoined = false;
        this.isStopped = false;
        this.timerId = null;
    }

    async joinMeeting() {
        try {
            console.log("Connecting to Google Meet...");
            await this.startMeet();
            await new Promise((resolve) => setTimeout(resolve, 10000));
            const isAdmitted = await this.waitForAdmission();
            if (isAdmitted) {
                await this.startRecording();
                this.monitorMeetingLive();
                new Promise((resolve) => setTimeout(resolve, this.duration));
                if (!this.isStopped) {
                    await this.stopRecording();
                }
            }
            else {
                this.killProcess();
            }
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
        const recordingsDir = "/app/recordings";
        if (!fs.existsSync(recordingsDir)) {
            fs.mkdirSync(recordingsDir, { recursive: true });
        }
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
        if (this.isStopped) return;
        await saveToS3(this.meetingId);
        await this.killProcess();
        this.isStopped = true;
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
        if (!this.driver) return false;
        const timeout = Date.now() + 300000;
        while (Date.now() < timeout) {
            try {
                const hangupButton = await this.driver.findElement(
                    By.css('button[aria-label="Leave call"]')
                );
                if (hangupButton) {
                    console.log("Successfully joined the meeting.");
                    return true;
                }
            } catch {
                console.log("Not yet in the meeting...");
            }
            await new Promise(res => setTimeout(res, 2000));
        }
        return false;
    }
    async isMeetingLive() {
        if (!this.driver) return null;
        try {
            const parentElement = await this.driver.wait(
                until.elementLocated(By.css('div.gFyGKf.BN1Lfc')),
                10000
            );
            const countElement = await parentElement.findElement(By.css('div.uGOf1d'));
            const countText = await countElement.getText();
            const count = parseInt(countText, 10);
            return Number.isNaN(count) ? null : count;
        } catch (error) {
            console.log(`[${this.meetingId}] Participant counter not found`);
            return null;
        }
    }
    async monitorMeetingLive() {
        console.log(`[${this.meetingId}] Starting to monitor live participants...`);
        while (this.driver && !this.isStopped) {
            const cnt = await this.isMeetingLive();
            console.log(`[${this.meetingId}] Current participant count:`, cnt);
            if (this.isStopped) break;
            if (cnt != null && cnt <= 1) {
                console.log(`[${this.meetingId}] Only 1 participant left, stopping recording.`);
                if (this.timerId) {
                    clearInterval(this.timerId);
                    this.timerId = null;
                }
                if (!this.isStopped) {
                    await this.stopRecording();
                }
                break;
            }
            
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    async killProcess() {
        const process = Meeting.ffmpegProcesses[this.meetingId];
        if (process) {
            process.kill("SIGINT");
            await new Promise((resolve) => {
                process.on("close", resolve);
            });
            if (this.driver) {
                await this.driver.quit();
                this.driver = null;
            }
            delete Meeting.ffmpegProcesses[this.meetingId];
        }
    }
}
