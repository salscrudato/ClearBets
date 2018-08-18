const express = require('express');
const cron = require('node-cron');
const mongoose = require('mongoose');
const config = require('./config/database');
const Bet = require('./models/bet');
const User = require('./models/user');
const request = require('request');

var results = [];

app = express();

mongoose.connect(config.database);

//On connect to db
mongoose.connection.on('connected', function(){
  console.log('Connected to database ' + config.database);
});

//On connection error
mongoose.connection.on('error', function(err){
  console.log('Database connection error ' + err);
});

cron.schedule("15 * * * *", function(){
  getAllJsonResults(function(results){
    getAllJsonBets(function(jsonOdds){
      for(var i = 0; i < jsonOdds.length; i++){
        getJsonResult(jsonOdds[i], results);
      }
    });
  });
});

//Get all JSON BetS
var getAllJsonBets = function(callback){
  const betStatus = 'open';
  const query = {status:betStatus}
  var jsonBets = [];
  Bet.find(query, function(err, bet) {
    if(err){
      console.log('Error');
    } else {
      bet.forEach(function(oneBet){
        if(oneBet.source=='jsonOdds'){
          jsonBets.push(oneBet);
        }
      });
      callback(jsonBets);
    }
  });
}

var getAllJsonResults = function(callback){
  var headers = {
    'x-api-key':'d3e32b4c-80f4-4522-8054-2992b1177805'
  }
  var finalResults = [];
  var options = {
    url: 'https://jsonodds.com/api/results',
    method: 'GET',
    headers: headers
  }
  request(options, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var data = JSON.parse(body);
      for(var i = 0; i < data.length; i++){
        // if(data[i].FinalType == 'Finished' && data[i].OddType == 'Game'){
        if(data[i].OddType == 'Game'){
          finalResults.push(data[i]);
        }
      }
      callback(finalResults);
    } else {
      console.log(error)
    }
  });
}

var allBetsSatisfied = function(action){
  var tmpRes = 1;
  for(var i = 0; i < action.subBets.length; i++){
    const status = action.subBets[i].calcResult;
    if(status != 'win' && status != 'loss' && status != 'draw'){
      tmpRes = 0;
    }
  }
  return tmpRes;
}

var checkWin = function(res){
  return res=='win';
}

var checkLoss = function(res){
  return res=='loss';
}

var calcBetResult = function(action){
  var tmpRes;
  var tmpResArr = [];
  for(var i = 0; i < action.subBets.length; i++){
    const status = action.subBets[i].calcResult;
    tmpResArr.push(status);
  }

  if(tmpResArr.every(checkWin)){
    return 'win';
  } else if(tmpResArr.every(checkLoss)){
    return 'loss';
  } else if(tmpResArr.every(checkDraw)){
    return 'draw';
  }

}

var closeBet = function(action, res){
  var tmpAmount;
  if(res=='win'){
    tmpAmount = parseFloat(action.winAmount);
  } else {
    tmpAmount = parseFloat(action.betAmount) * -1;
  }
  Bet.closeBet(action._id, res, function(err, bet){
    if(err){
      console.log(err);
    } else {
      updateBalance(action.userId, tmpAmount);
    }
  });
}

var updateBalance = function(userId, amount){

  User.getUserById(userId, function(err, user){
    if(!err){
      const newBal = user.currentBalance + amount;
      User.updateBalance(userId, newBal, function(err, res){
        if(err){
          console.log(err);
        } else {
          console.log(res);
        }
      });
    } else {
      console.log(err);
    }
  });

}

var getJsonResult = function(action, results){
  var result = 'noResult';
  var subBets = [];
  for(var i = 0; i < action.subBets.length; i++){
    subBets.push(action.subBets[i]);
  }
  console.log('=====One Action=====');
  for(var i = 0; i < subBets.length; i++){
    curBet = subBets[i];
    const id = curBet.id;
    const betType = curBet.betType;
    const line = curBet.line;
    console.log('Bet Type: ' + betType);
    for(var j = 0; j < results.length; j++){
      if(results[j].ID == id){
        var homeScore = results[j].HomeScore;
        var awayScore = results[j].AwayScore;
        if(results[j].FinalType == 'Finished' && homeScore != null && awayScore!= null){

          if(betType=='homeTeamML'){
            if(homeScore > awayScore){
              subBets[i].calcResult = 'win';
            } else if(homeScore < awayScore){
              subBets[i].calcResult = 'loss';
            } else if(homeScore == awayScore){
              subBets[i].calcResult = 'draw';
            }
          }
          if(betType=='awayTeamML'){
            if(awayScore > homeScore){
              subBets[i].calcResult = 'win';
            } else if(awayScore < homeScore){
              subBets[i].calcResult = 'loss';
            } else if(homeScore == awayScore){
              subBets[i].calcResult = 'draw';
            }
          }
          if(betType=='homeTeamRL'){
            homeScore = homeScore + parseFloat(curBet.line);
            if(homeScore > awayScore){
              subBets[i].calcResult = 'win';
            } else if(homeScore < awayScore){
              subBets[i].calcResult = 'loss';
            } else if(homeScore == awayScore){
              subBets[i].calcResult = 'draw';
            }
          }
          if(betType=='awayTeamRL'){
            if(awayScore > homeScore){
              subBets[i].calcResult = 'win';
            } else if(awayScore < homeScore){
              subBets[i].calcResult = 'loss';
            } else if(homeScore == awayScore){
              subBets[i].calcResult = 'draw';
            }
          }
          if(betType=='over'){
            const totalNumber = subBets[i].totalNumber;
            if(homeScore + awayScore > totalNumber){
              subBets[i].calcResult = 'win';
            } else if(homeScore + awayScore < totalNumber){
              subBets[i].calcResult = 'loss';
            } else if(homeScore + awayScore == totalNumber){
              subBets[i].calcResult = 'draw';
            }
          }
          if(betType=='under'){
            const totalNumber = subBets[i].totalNumber;
            if(homeScore + awayScore < totalNumber){
              subBets[i].calcResult = 'win';
            } else if(homeScore + awayScore > totalNumber){
              subBets[i].calcResult = 'loss';
            } else if(homeScore + awayScore == totalNumber){
              subBets[i].calcResult = 'draw';
            }
          }
          //console.log('home: ' + curBet.homeTeam + ':' + homeScore + ' away: ' + curBet.awayTeam + ':' + awayScore);
        }
      }
    }

    if(allBetsSatisfied(action)){
      const res = calcBetResult(action);
      if(res=='win' || res=='loss'){
        //===Temp===
        closeBet(action, res);
      }
    }
  }
}
