

import express from 'express';
import path from 'path';
const app = express();
const port = 4000;
import fs from 'fs';
import axios from 'axios';
import OpenAI from 'openai';
import fileURLToPath from 'url';
import bodyParser from 'body-parser';
import { get } from 'http';
import { URL } from 'url';
//import { OpenAI } from "@langchain/openai"
//const sqlite3 = require('sqlite3');

let assistants = {}
//let tools = [{ role:"function", type: "code_interpreter" }, { role:"function",type: "retrieval" }]
let tools = [];

 
// Serve static images from the 'images' folder
const __dirname = new URL('.', import.meta.url).pathname;

app.use(express.static(__dirname +'/images'));


const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// connect to db and get cursor
// Example usage:
//const dbPath = 'data/prompts.db';
//const db = getConnection(dbPath);

// Define global variables focus to keep track of the assistant, file, thread and run
let focus = { assistant_id: "", assistant_name: "", file_id: "", thread_id: "", message: "", func_name: "", run_id: "", status: "" };


// Middleware to parse JSON payloads in POST requests
app.use(express.json());

// Serve index.html at the root URL '/'
//get the root directory

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '/index.html')); 
});
//
// Create a new assistant along with Thread and Run System Prompt
app.post('/run_assistant', async (req, res) => {
    let name = req.body.assistant_name;
    let instructions = req.body.message;
    if (tools.length < 2) {
        //tools = [{ type: "code_interpreter" }, { type: "retrieval" }]
    }
    // this puts a message onto a thread and then runs the assistant on that thread
    let run_id;
    let messages = [];  // this accumulates messages from the assistant
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
    let assistant = await create_or_get_assistant(name);
    let thread = await create_or_get_thread()

    focus.assistant_id = assistant.id;
    focus.thread_id = thread.id;
    focus.assistant_name = assistant.name;
    messages = await runAssistant(focus.assistant_id, focus.thread_id, instructions);
    res.status(200).json({ message: messages, focus: focus });
});

async function create_or_get_assistant(name, instructions) {
    const response = await openai.beta.assistants.list({
        order: "desc",
        limit: 20,
    })
    // loop over all assistants and find the one with the name name
    let assistant = {};
    for (let obj in response.data) {
        assistant = response.data[obj];
        // change assistant.name to small letters
        if (assistant.name.toLowerCase() == name.toLowerCase()) {
            focus.assistant_id = assistant.id;
            tools = assistant.tools;  // get the tool
            break
        }
    }
    if (focus.assistant_id == "") {
        assistant = await openai.beta.assistants.create({
            name: name,
            instructions: instructions,
            tools: tools,
            model: "gpt-4-1106-preview",
        });
        focus.assistant_id = assistant.id
        focus.assistant_name = name;
    }
    return assistant;
}
async function create_or_get_thread() {
    let response = {}
    if (focus.thread_id == "") {
        // do we need an intitial system message on the thread?
        response = await openai.beta.threads.create(
            /*messages=[
            {
              "role": "user",
              "content": "Create data visualization based on the trends in this file.",
              "file_ids": [focus.file_id]
            }
          ]*/
        )
        focus.thread_id = response.id;
    }
    return response;
}
// create a new assistant
app.post('/create_assistant', async (req, res) => {
    // we should define the system message for the assistant in the input
    let system_message = req.body.system_message;
    let name = req.body.assistant_name;
    let instruction = "you are a helpful tool calling assistnt."
    try {
        let assistant = await create_or_get_assistant(name, instruction);
        let assistant_id = assistant.id;

        message = "Assistant created with id: " + assistant_id;
        res.status(200).json({ message: message, focus: focus });
    }
    catch (error) {
        return console.error('Error:', error);
    }
}
)
// get assistant by name
app.post('/get_assistant', async (req, res) => {
    let name = req.body.assistant_name;
    let instruction = "";
    let assistant = await create_or_get_assistant(name, instruction);
    focus.assistant_name = assistant.name;
    focus.assistant_id = assistant.id;
    console.log('Modify request received:', req.body);
    let message = `got Assistant ${name} :` + JSON.stringify(assistant);
    res.status(200).json({ message: message, focus: focus });
});

// this lists out all the assistants and extracts the latest assistant id and stores it in focus
app.post('/list_assistants', async (req, res) => {
    try {
        const response = await openai.beta.assistants.list({
            order: "desc",
            limit: 10,
        })
        console.log(`list of assistants ${JSON.stringify(response.data)}`);
        focus.assistant_id = extract_assistant_id(response.data).assistant_id;
        let message = JSON.stringify(response.data);
        res.status(200).json({ message: message, focus: focus });
    }
    catch (error) {
        return console.error('Error:', error);
    }
})
function extract_assistant_id(data) {
    let assistant_id = "";
    if (data.length > 0) {
        assistant_id = data[0].id;
        tools = data[0].tools
        // loop over assistants and extract all the assistants into a dictionary
        for (let assistant of data) {
            assistants[assistant.name] = assistant;
        }
    }

    console.log("got assistant_id: " + assistant_id);
    return { assistant_id: assistant_id, tools: tools }
}


app.post('/delete_assistant', async (req, res) => {
    try {
        let assistant_id = req.body.assistant_id;
        console.log("Deleting assistant_id: " + assistant_id);
        const response = await openai.beta.assistants.del(assistant_id);

        // Log the first greeting
        console.log(
            `deleted assistant ${JSON.stringify(response)}.\n`
        );
        message = "Assistant deleted with id: " + assistant_id;
        focus.assistant_id = "";
        res.status(200).json({ message: message, focus: focus });
    }
    catch (error) {
        return console.error('Error:', error);
    }
});

app.post('/create_run', async (req, res) => {
    let thread_id = req.body.thread_id;
    let assistant_id = req.body.assistant_id;
    console.log("create_run thread_id: " + thread_id + " assistant_id: " + assistant_id);
    try {
        let response = await openai.beta.threads.runs.create(thread_id, {
            assistant_id: assistant_id
        })
        focus.run_id = response.id;
        console.log("create_run response: " + JSON.stringify(response));
        res.status(200).json({ message: JSON.stringify(response), focus: focus });
    }
    catch (error) {
        console.log(error);
        res.status(500).json({ message: 'Run Delete failed' });
    }
});
//
// this is the main loop in handling messages calling functions etc
//
app.post('/run_status', async (req, res) => {
    let thread_id = req.body.thread_id;
    let run_id = req.body.run_id;
    try {
        let response = await openai.beta.threads.runs.retrieve(thread_id, run_id)
        let message = response;
        focus.status = response.status;
        let tries = 0;
        while (response.status == 'in_progress' && tries < 10) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for 1 second
            response = await openai.beta.threads.runs.retrieve(thread_id, run_id);
            tries += 1;
        }
        if (response.status === "requires_action") {
            get_and_run_tool(response);
        }

        if (response.status == "completed" || response.status == "failed") {
            let message = "Completed run with status: " + response.status;
            res.status(200).json({ message: message, focus: focus });
        }

    }
    catch (error) {
        console.log(error);
        res.status(500).json({ message: 'Run Status failed' }, focus);
    }
})

app.post('/create_message', async (req, res) => {
    let prompt = req.body.message;
    let thread_id = req.body.thread_id;
    console.log("create_message: " + prompt + " thread_id: " + thread_id);
    try {
        let response = await openai.beta.threads.messages.create(thread_id,
            {
                role: "user",
                content: prompt,
            })
        let message = await response;
        console.log("create message response: " + JSON.stringify(response));
        res.status(200).json({ message: message, focus: focus });
    }
    catch (error) {
        console.log(error);
        res.status(500).json({ message: 'Create  Message failed' });
    }
});


app.post('/get_messages', async (req, res) => {
    let thread_id = focus.thread_id;
    let run_id = focus.run_id;
    console.log("get_messages: on thread_id: " + thread_id + " run_id: " + run_id);
    try {

        await get_run_status(thread_id, run_id);
        // now retrieve the messages
        let response = await openai.beta.threads.messages.list(thread_id)
        let all_messages = get_all_messages(response);
        res.status(200).json({ message: all_messages, focus: focus });
    }
    catch (error) {
        console.log(error);
        res.status(500).json({ message: 'Get messages failed' });
    }
});
function get_all_messages(response) {
    let all_messages = [];
    let role = "";
    let content = "";
    for (let message of response.data) {
        // pick out role and content
        role = message.role;
        content = message.content[0].text.value;
        all_messages.push({ role, content });
    }
    return all_messages
}
//
// this puts a message onto a thread and then runs the assistant 
async function runAssistant(assistant_id, thread_id, user_instructions) {
    try {
        await openai.beta.threads.messages.create(thread_id,
            {
                role: "user",
                content: user_instructions,
            })
        let run = await openai.beta.threads.runs.create(thread_id, {
            assistant_id: assistant_id
        })
        run_id = run.id;
        focus.run_id = run_id;
        focus.assistant_id = assistant_id;
        focus.thread_id = thread_id;
        await get_run_status(thread_id, run_id); // blocks until run is completed
        // now retrieve the messages
        let response = await openai.beta.threads.messages.list(thread_id)
        return get_all_messages(response);

    }
    catch (error) {
        console.log(error);
        return error;
    }
}
async function get_run_status(thread_id, run_id) {
    try {
        let response = await openai.beta.threads.runs.retrieve(thread_id, run_id)
        let message = response;
        focus.status = response.status;
        let tries = 0;
        while (response.status == 'in_progress' && tries < 10) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for 1 second
            response = await openai.beta.threads.runs.retrieve(thread_id, run_id);
            tries += 1;
        }
        if (response.status === "requires_action") {
            get_and_run_tool(response);
        }

        if (response.status == "completed" || response.status == "failed") {

        }
        // await openai.beta.threads.del(thread_id)
        return
    }
    catch (error) {
        console.log(error);
        return error;
    }
}


app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});