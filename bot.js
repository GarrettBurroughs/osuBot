// Node Library imports
const Discord = require('discord.js');
const fs = require('fs');
const fetch = require('node-fetch');
const request = require('request')
const express = require('express');
const serveIndex = require('serve-index')

// Express App initialization
const app = express();
const port = 8082;


// Authentication File Reading
let contents = fs.readFileSync('auth.txt', 'utf8');
let osuAPI, discordToken;
[osuAPI, discordToken, sheetLink] = contents.split(", ");

// Global Bot Information
let inputChannel;
let postChannel;
let globalWarmups;

// Log 
const startTime = new Date(Date.now());
const logFile = `logs/osuBotLog-${startTime.getFullYear()}-${startTime.getMonth()}-${startTime.getDay()}_${startTime.getHours() % 12}-${startTime.getMinutes()}-${startTime.getSeconds()}.txt`;
console.log(logFile);
// init log file
var dir = './logs';
if (!fs.existsSync(dir)){ fs.mkdirSync(dir); }
fs.writeFile(logFile,
  `============================================================ OSU TOURNAMENT BOT LOG FILE - ${startTime.getFullYear()}/${startTime.getMonth()}/${startTime.getDay()} ${startTime.getHours() % 12}:${startTime.getMinutes()}:${startTime.getSeconds()} ============================================================ \n`,
  (err) => {
    if (err) throw err
  });

// Express Log Hosting
app.listen(port, () => log(`osu tournament bot listening on port ${port}!`));
app.use('/', express.static('logs'), serveIndex('logs', {
  'icons': true,
  'view': 'details'
}));

let prefix = ".t "

const embedColor = 3447003;
const helpData = [{
    command: "prefix <prefix>",
    description: "sets the bot's prefix"
  },
  {
    command: "help",
    description: "Displays information and usage of each command"
  },
  {
    command: "prefix",
    description: "Shows the current bot prefix"
  },
  {
    command: "setInputChannel",
    description: "sets the current channel to the inputChannel, where matches can be posted"
  },
  {
    command: "setPostChannel",
    description: "sets the currnet channel where matches will be posted by the bot"
  },
  {
    command: "postMatch <matchID> <(optional)Warmups>",
    description: "Posts the match of the provided match ID, results will be stored to the spreadsheet and the match will be displayed in the postChannel, if <warmups> is not specified, the global waramups will be displayed"
  },
  {
    command: "postMatch <matchID> <player/team1> <player/team2> <(optional)Warmups>",
    description: "Posts the match of the provided match ID, use this if there is a problem with the player name, or in team style tournaments, results will be stored to the spreadsheet and the match will be displayed in the postChannel, if <warmups> is not specified, the global waramups will be displayed"
  },
  {
    command: "setWarmups <warmups>",
    description: "Globally sets the amount of warmups per match"
  },
  {
    command: "forfeit <Player 1> <Player 2> <Winner>",
    description: "Posts a forfeited match"
  }

]


// Discord Bot Creation
const client = new Discord.Client();

// Login callback
client.on('ready', () => {
  log(`Logged in as ${client.user.tag}!`);
});


// Message Handling
client.on('message', async msg => {

  // Message Parsing
  let content = msg.content;
  if (content.indexOf(prefix) === 0) {
    // Prefix handling
    content = content.replace(prefix, "");
    log(content);
    let args = parseStr(content);

    // ======================================================================================================================================
    // BOT COMMANDS
    // ======================================================================================================================================

    // ============================== Set Prefix Command ==============================
    if (args[0] === "setPrefix") {
      if (!checkPrivelage(msg)) {
        msg.reply("You do not have permission to do this");
        return;
      }
      if (args[1] === undefined) {
        msg.channel.send(`INVALID PREFIX`);
      } else {
        prefix = args[1];
        msg.channel.send(`My prefix has now been set to \`${prefix}\``);
      }
    }



    // ============================== Get Prefix Command ==============================
    if (args[0] === "prefix") {
      msg.channel.send(`My current prefix is \`${prefix}\` you can run \`setPrefix <prefix>\` to change it`);
    }



    // ============================== Warmups ==============================
    if (args[0] === "setWarmups") {
      if (!checkPrivelage(msg)) {
        msg.reply("You do not have permission to do this");
        return;
      }
      globalWarmups = args[1];
      msg.channel.send(`This tournament will now default to ${globalWarmups} warmups in each match`);
    }



    // ============================== Forfeit ==============================
    if (args[0] === "forfeit") {
      let output = "";
      if (!inputChannel) {
        msg.reply(`Input channel has not been set, set it by using \`${prefix}setInputChannel <channel>\``);
        return;
      }
      if (!postChannel) {
        msg.reply(`Post channel has not been set, set it by using \`${prefix}setPostChannel <channel>\``);
        return;
      }
      if (msg.channel !== inputChannel) {
        msg.channel.send("You cannot post matches in this channel");
        return;
      }
      let team1 = args[1];
      let team2 = args[2];
      output += `${team1} vs ${team2}: **Forfeit** \n`
      output += "__**Final Results**__ \n";
      output += `${team1} - **${args[3] == 1 ? 0 : -1}** | **${args[3] == 2 ? 0 : -1}** - ${team2} \n`;
      if (args[3] == 1) {
        output += `Winner: **${team1}**! \n`;
      } else {
        output += `Winner: **${team2}**! \n`;
      }
      postChannel.send(output);

      postData([
        "N/A", // timeout
        `OPCT: (${team1}) vs (${team2})`, // Name
        team1, // Player 1
        team2, // Player 2
        args[3] == 1 ? 0 : -1, // Score 1
        args[3] == 2 ? 0 : -1, // Score 2
        "Forfeit" // Match history
      ]);
    }



    // ============================== Post Match ==============================
    if (args[0] === "postMatch") {

      // Check Channel 
      if (!inputChannel) {
        msg.reply(`Input channel has not been set, set it by using \`${prefix}setInputChannel <channel>\``);
        return;
      }
      if (!postChannel) {
        msg.reply(`Post channel has not been set, set it by using \`${prefix}setPostChannel <channel>\``);
        return;
      }
      if (msg.channel !== inputChannel) {
        msg.channel.send("You cannot post matches in this channel");
        return;
      }


      // Generate Match output
      let output = ""
      results = await getMatch(args[1]);
      log(results);

      // Ensure the match has finished
      if (!results.match.end_time) {
        inputChannel.send("match has not finished, please close the match before posting the score");
        return;
      }

      // Get teams
      let team1;
      let team2;
      let warmups;
      if (args[3]) {
        team1 = args[2];
        team2 = args[3];
        warmups = args[4]
      } else {
        [team1, team2] = await processMatchNames(args[1]);
        warmups = args[2];
      }

      log(results.match.name);

      // Create Discord embed object (Makes things pretty)
      let embedOut = {
        color: embedColor,
        author: {
          name: client.user.username,
          icon_url: client.user.avatarURL
        },
        title: `${results.match.name}`,
        url: "https://osu.ppy.sh/community/matches/" + args[1],
        fields: []
      }

      // Generate Discord Output
      let gameInfo = await matchInfo(results, warmups);
      gameInfo.games.forEach(game => {
        field = {
          name: `${game.mapName}`,
          url: `https://osu.ppy.sh/beatmaps/${game.mapId}`,
          value: ""
        }
        if (game.winner === 1) {
          field.value = `**${team1} - ${game.team1Score}** | ${game.team2Score} - ${team2}`
        } else if (game.winner === 2) {
          field.value = `${team1} - ${game.team1Score} | **${game.team2Score} - ${team2}**`;
        }
        embedOut.fields.push(field);
      });

      // Create final message results
      output += "__**Final Results**__ \n";
      output += `${team1} - ${gameInfo.team1Score} | ${gameInfo.team2Score} - ${team2} \n`;
      if (gameInfo.winner === 1) {
        output += `Winner: **${team1}**! \n`;
      } else if (gameInfo.winner === 2) {
        output += `Winner: **${team2}**! \n`;
      }
      output += "\n";

      // Log information
      matchInfo(results, args[2]).then(res => {
        log(res)
      }).catch((err) => {
        log(err)
      });
      log(embedOut);

      // Send output to channel
      postChannel.send({
        embed: embedOut
      });
      // Post match information to sheet
      postData([
        results.match.start_time, // timeout
        results.match.name, // Name
        team1, // Player 1
        team2, // Player 2
        gameInfo.team1Score, // Score 1
        gameInfo.team2Score, // Score 2
        embedOut.url // Match history
      ]);
      postChannel.send(output);
    }



    // ============================== Set Input Channel ==============================
    if (args[0] === "setInputChannel") {
      if (!checkPrivelage(msg)) {
        msg.reply("You do not have permission to do this");
        return;
      }
      inputChannel = msg.channel;
      msg.channel.send(`set \`#${msg.channel.name}\` as the input channel, you can now post match results`);
    }



    // ============================== Set Output Channel ==============================
    if (args[0] === "setPostChannel") {
      if (!checkPrivelage(msg)) {
        msg.reply("You do not have permission to do this");
        return;
      }
      postChannel = msg.channel;
      msg.channel.send(`set \`#${msg.channel.name}\` as the posting channels, all match results will be posted there`);
    }



    // ============================== Help ==============================
    if (args[0] === "help") {
      let embedOut = {
        color: embedColor,
        author: {
          name: client.user.username,
          icon_url: client.user.avatarURL
        },
        title: `Command Help`,
        fields: []
      }
      helpData.forEach(command => {
        embedOut.fields.push({
          name: `${prefix}${command.command}`,
          value: command.description
        });
      });

      msg.channel.send({
        embed: embedOut
      });
    }
  }
});


async function getMatch(id) {
  let key = osuAPI;
  let url = `https://osu.ppy.sh/api/get_match?k=${key}&mp=${id}`;
  let json = await fetch(url).then(res => res.json());
  return json;
}


async function matchInfo(json, warmups) {
  warmups = warmups || globalWarmups;

  let output = {
    games: [],
    team1Score: 0,
    team2Score: 0,
    winner: 0
  }
  let counter = 0;
  for (game of json.games) {
    counter++;
    if (counter <= warmups) {
      continue;
    }
    let res;
    try{
      res = await calculateGame(game);
      output.games.push(res);
      if (res.winner === 1) {
        output.team1Score++;
      } else if (res.winner === 2) {
        output.team2Score++;
      }
    }catch(err){
      log(err);
    }
  }

  if (output.team1Score > output.team2Score) {
    output.winner = 1;
  } else if (output.team1Score < output.team2Score) {
    output.winner = 2;
  }

  return output;
}

async function calculateGame(game) {
  let output = {
    teamVs: false,
    mapName: "",
    mapId: game.beatmap_id,
    team1Score: 0,
    team2Score: 0,
    winner: 0
  }

  if (game.team_type == 0) {
    output.teamVs = false;
  } else {
    output.teamVs = true;
  }

  // Calculate Team Scores
  let score1 = 0;
  let score2 = 0;
  if (output.teamVs) {
    game.scores.forEach(score => {
      if (score.team == 1) {
        score1 = score1 + parseInt(score.score);
        log(score.score);
      } else {
        score2 = score2 + parseInt(score.score);
        log(score.score);
      }
      output.team1Score = score1;
      output.team2Score = score2;
    });
  } else {
    // Ref needs to be in last slot
    output.team1Score = parseInt(game.scores[0].score);
    output.team2Score = parseInt(game.scores[1].score);
    score1 = parseInt(game.scores[0].score);
    score2 = parseInt(game.scores[1].score);
  }

  if (parseInt(score1) > parseInt(score2)) {
    output.winner = 1;
  } else {
    output.winner = 2;
  }

  if (parseInt(game.scores[0].pass) != 1) {
    output.winner = 2;
  }

  if (parseInt(game.scores[1].pass) != 1) {
    output.winner = 1;
  }

  let map = await getBeatmap(game.beatmap_id);
  // log(map);
  let name = `${map[0].title} [${map[0].version}]`;
  output.mapName = name;

  return output;
}

async function getBeatmap(id) {
  let key = osuAPI;
  let url = `https://osu.ppy.sh/api/get_beatmaps?k=${key}&b=${id}`;
  let json = await fetch(url).then(res => res.json());
  return json;
}

function postData(data) {
  log(data);
  request.post(sheetLink, {
    json: {
      data: data
    }
  }, (error, res, body) => {
    if (error) {
      console.error(error)
      return
    }
    log(`statusCode: ${res.statusCode}`)
  })
}

function parseStr(string) {
  let output = [];
  if (!string.includes("\"")) {
    output = string.split(" ");
  } else {
    let prevIndex = -1
    let prevChar = " ";
    for (let i = 0; i < string.length; i++) {
      if (string[i] == "\"" && prevChar != "\"") {
        prevIndex = i;
        prevChar = "\"";
      } else if (string[i] == prevChar) {
        output.push(string.substring(prevIndex + 1, i));
        prevIndex = i;
        prevChar = " ";
        if (string[i] == "\"") i++;
      }
    }
  }
  return output;
}

function checkPrivelage(msg) {
  return (msg.member.user.username == "Animelord9999");
}

async function processMatchNames(matchID) {
  let player1;
  let player1Team;
  let player2;
  let player2Team;

  let matchData = await fetch(`https://osu.ppy.sh/api/get_match?k=${osuAPI}&mp=${matchID}`, {
    method: 'GET',
  }).then((res) => res.json());
  let names = parseName(matchData.match.name);
  player1 = names[0];
  player2 = names[1];
  let player1Data = await fetch(`https://osu.ppy.sh/api/get_user?k=${osuAPI}&u=${names[0]}`).then((res) => res.json());
  let player2Data = await fetch(`https://osu.ppy.sh/api/get_user?k=${osuAPI}&u=${names[1]}`).then((res) => res.json());
  let player1ID = player1Data[0].user_id;
  let player2ID = player2Data[0].user_id;

  for (let i = 0; i < matchData.games[globalWarmups].scores.length; i++) {
    if (matchData.games[globalWarmups].scores[i].user_id === player1ID) {
      player1Team = i;
    }
    if (matchData.games[globalWarmups].scores[i].user_id === player2ID) {
      player2Team = i;
    }
  }
  log(player1Team, player2Team);
  return player1Team < player2Team ? [player1, player2] : [player2, player1];
}

function parseName(matchName) {
  let start = 0;
  let names = [];

  for (let i = 0; i < matchName.length; i++) {
    if (matchName.charAt(i) === '(') {
      start = i;
    }
    if (matchName.charAt(i) === ")") {
      names.push(matchName.substring(start + 1, i));
    }
  }
  return names;
}


client.login(discordToken);

function log(message) {
  let currTime = new Date(Date.now());
  let date = `${currTime.getDate()}-${currTime.getMonth()}-${currTime.getFullYear()}`;
  let time = `${currTime.getHours()}:${currTime.getMinutes()}:${currTime.getSeconds()}`
  message = `${date} ${time} -> ${message}`;
  console.log(message);
  fs.appendFile(logFile, message + "\n", (err) => {
    if (err) throw err;
  });
}
