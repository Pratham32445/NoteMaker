    import { Builder, Browser, By, until, WebDriver } from 'selenium-webdriver';
    import { Options } from "selenium-webdriver/chrome";
    import { spawn } from "child_process";

    export class Meeting {
        meetingId: string;
        driver: WebDriver | null;
        delay = 30000;
        static ffmpegProcesses: { [meetingId: string]: any } = {};

        constructor(meetingId: string) {
            this.meetingId = meetingId;
            this.driver = null;
        }

        async joinMeeting() {
            try {
                console.log("Connecting to Google Meet...");
                await this.startMeet();
                await new Promise((resolve) => setTimeout(resolve, this.delay));
                await this.startRecording();
            } catch (error) {
                console.error("Error in joinMeeting:", error);
            } finally {
                if (this.driver) {
                    await this.driver.quit();
                }
            }
        }

        async getDriver() {
            const options = new Options();
            options.addArguments(
                "--disable-blink-features=AutomationControlled",
                "--use-fake-ui-for-media-stream",
                "--window-size=1080,720",
                "--auto-select-desktop-capture-source=[RECORD]",
                "--allow-running-insecure-content",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-software-rasterizer",
                "--disable-setuid-sandbox",
                "--disable-extensions",
                "--disable-background-networking",
                "--disable-background-timer-throttling",
                "--disable-client-side-phishing-detection",
                "--disable-default-apps",
                "--disable-hang-monitor",
                "--disable-popup-blocking",
                "--disable-prompt-on-repost",
                "--disable-sync",
                "--metrics-recording-only",
                "--no-first-run",
                "--safebrowsing-disable-auto-update",
                "--password-store=basic",
                "--use-mock-keychain"
            );

            const seleniumUrl = process.env.SELENIUM_REMOTE_URL || "http://selenium:4444/wd/hub";
            console.log("Connecting to Selenium at:", seleniumUrl);

            let driver = await new Builder()
                .forBrowser(Browser.CHROME)
                .setChromeOptions(options)
                .usingServer(seleniumUrl)
                .build();

            return driver;
        }

        async startRecording() {
            if (!this.driver) return;
            await new Promise((r) => setTimeout(r, 10000));
            const outputFile = `/app/meet_recording_${this.meetingId}.mp4`;
            const ffmpegArgs = [
                "-y",
                "-video_size", "1280x720",
                "-framerate", "25",
                "-f", "x11grab",
                "-i", ":99",
                "-c:v", "libx264",
                "-preset", "ultrafast",
                outputFile
            ];
            console.log(`[${this.meetingId}] Starting ffmpeg recording: ${ffmpegArgs.join(" ")}`);
            const ffmpegProcess = spawn("ffmpeg", ffmpegArgs, { stdio: "inherit" });
            ffmpegProcess.on("exit", (code) => {
                console.log(`[${this.meetingId}] ffmpeg exited with code ${code}`);
            });
            Meeting.ffmpegProcesses[this.meetingId] = ffmpegProcess;
        }

        async startMeet() {
            const driver = await this.getDriver();
            this.driver = driver;
            const meetUrl = `https://meet.google.com/${this.meetingId}`;
            console.log("Opening Meet URL:", meetUrl);
            await driver.get(meetUrl);
            await driver.sleep(4000);
            try {
                const popupButton = await driver.wait(
                    until.elementLocated(By.xpath('//span[contains(text(), "Got it")]')), 8000
                );
                await popupButton.click();
                console.log("Clicked 'Got it' popup.");
            } catch (e) {
                console.log("No 'Got it' popup found.");
            }
            try {
                const nameInput = await driver.wait(
                    until.elementLocated(By.xpath('//input[@placeholder="Your name"]')), 8000
                );
                await nameInput.clear();
                await nameInput.sendKeys("Fathom");
                await driver.sleep(1000);
                console.log("Entered guest name.");
            } catch (e) {
                console.log("No guest name input found (maybe already logged in or not required).");
            }
            try {
                const joinButton = await driver.wait(
                    until.elementLocated(By.xpath('//span[contains(text(), "Ask to join") or contains(text(), "Join now")]')),
                    10000
                );
                await joinButton.click();
                console.log("Clicked join button.");
            } catch (e) {
                console.log("Join button not found. Maybe already in meeting or waiting room.");
            }
        }
    }
