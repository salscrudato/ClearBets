const express = require('express');
const cron = require('node-cron');
const mongoose = require('mongoose');
const config = require('./config/database');
const Bet = require('./models/bet');
const User = require('./models/user');
const request = require('request');

var userBalanceArray = [];

mongoose.connect(config.database);

//Gets all users and balances and adds them to the userBalanceArray
var getAllUserBalances = function(callback){
  User.find(function(err, user){
    if(!err){
      user.forEach(function(oneUser){
        userBalanceArray.push({userId: oneUser._id, currentBalance: oneUser.currentBalance});
      });
      callback(true);
    }else{
      callback(false);
    }
  });
}

//Gets all Bets and returns them in callback
var getAllOpenBets = function(source, callback){
  const query = {status:'open'}
  var betsArray = [];
  Bet.find(query, function(err, bet) {
    if(err){
      callback(false);
    } else {
      bet.forEach(function(oneBet){
        if(oneBet.source==source){
          betsArray.push(oneBet);
        }
      });
      callback(betsArray);
    }
  });
}

//Gets all JSON Results
var getAllJsonResults = function(callback){
  var finalResults = [];
  var headers = {
    'x-api-key':'d3e32b4c-80f4-4522-8054-2992b1177805'
  }
  var options = {
    url: 'https://jsonodds.com/api/results',
    method: 'GET',
    headers: headers
  }
  request(options, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var data = JSON.parse(body);
      for(var i = 0; i < data.length; i++){
        if(data[i].FinalType == 'Finished' && data[i].OddType == 'Game'){
          finalResults.push(data[i]);
        }
      }
      callback(finalResults);
    } else {
      callback(false);
    }
  });
}

var getBet365Result = function(betId, callback){
  var tmpId = betId;
  baseUrl = 'https://api.betsapi.com/v1/bet365/result?token=10744-6nAVE6st6PH0mD&event_id=';
  tempUrl = baseUrl + betId;
  var options = {
    url: tempUrl,
    method: 'GET'
  }
  request(options, function (error, response, body) {
    if (!error && response.statusCode == 200) {

      var finalType = null;
      var homeScore = null;
      var awayScore = null;
      var ID = null;
      var homeScoreFirstHalf = null;
      var awayScoreFirstHalf = null;
      var firstInningScore = null;

      data = JSON.parse(body);
      for(var i = 0; i < data.results.length; i++){
        var finalType = data.results[i].time_status;
        if(finalType == 3){
          finalType = 'Finished';
          var homeScore = data.results[i].ss.split('-')[1];
          var awayScore = data.results[i].ss.split('-')[0];
          if(data.results[i].sport_id == 12){
            homeScoreFirstHalf = parseInt(data.results[i].scores["3"]["away"]);
            awayScoreFirstHalf = parseInt(data.results[i].scores["3"]["home"]);
          } else if (data.results[i].sport_id == 16){
            firstInningScore = parseInt(data.results[i].scores["1"]["away"]) + parseInt(data.results[i].scores["1"]["home"]);
            for(var j = 1; j < 6; j++){
              homeScoreFirstHalf = parseInt(data.results[i].scores[j]["away"]) + homeScoreFirstHalf;
              awayScoreFirstHalf = parseInt(data.results[i].scores[j]["home"]) + awayScoreFirstHalf;
            }
          } else if (data.results[i].sport_id == 1){
            homeScore = data.results[i].ss.split('-')[0];
            awayScore = data.results[i].ss.split('-')[1];
            homeScoreFirstHalf = parseInt(data.results[i].scores["1"]["home"]);
            awayScoreFirstHalf = parseInt(data.results[i].scores["1"]["away"]);
          }
        } else {
          finalType = 'NotFinished';
        }
        callback({
          ID: tmpId,
          HomeScore: homeScore,
          AwayScore: awayScore,
          HomeScoreFirstHalf: homeScoreFirstHalf,
          AwayScoreFirstHalf: awayScoreFirstHalf,
          firstInningScore: firstInningScore,
          FinalType: finalType
        });
      }
    } else {
      callback({success: false});
    }
  });
}

//Gets all Bet365 Results
var getAllBet365Results = function(bets, callback){
  var finalResults = [];
  var requests = 0;
  const betsLength = bets.length;

  for(var i = 0; i < betsLength; i++){
    getBet365Result(bets[i], function(result){
      finalResults.push(result);
      requests = requests + 1;
      if(requests==betsLength){
        callback(finalResults);
      }
    });
  }
}

var createBet365String = function(bets){
  var betIdArr = [];
  for (var i = 0; i < bets.length; i++){
    for(var j = 0; j < bets[i].subBets.length; j++){
      betIdArr.push(bets[i].subBets[j].id);
    }
  }
  return betIdArr;
}

//Checks if all bets within a bet are satisfied
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

var checkDraw = function(res){
  return res=='draw';
}

//Checks the status of all bets within a bet and returns the status
var calcBetResult = function(action){
  var tmpResArr = [];
  for(var i = 0; i < action.subBets.length; i++){
    const status = action.subBets[i].calcResult;
    tmpResArr.push(status);
  }
  for(var i = 0; i < tmpResArr.length; i++){
    if(tmpResArr[i]=='loss'){
      return 'loss';
    }
  }
  if(tmpResArr.every(checkWin)){
    return 'win';
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
  var updateAmount = 0;
  User.getUserById(userId, function(err, user){
    if(!err){
      for(var i = 0; i < userBalanceArray.length; i++){
        if(userBalanceArray[i].userId==userId){
          updateAmount = userBalanceArray[i].currentBalance;
          userBalanceArray[i].currentBalance = userBalanceArray[i].currentBalance + amount;
        }
      }
      const newBal = amount + updateAmount;
      User.updateBalance(userId, newBal, function(err, res){
        if(err){
          //TODO if error we need some type of fail safe here
        } else {
          return true;
        }
      });
    } else {
      //TODO if error we need some type of fail safe here
    }
  });
}


var getBetResults = function(action, results, callback){
  var result = 'noResult';
  var subBets = [];
  for(var i = 0; i < action.subBets.length; i++){
    subBets.push(action.subBets[i]);
  }
  for(var i = 0; i < subBets.length; i++){
    curBet = subBets[i];
    const id = curBet.id;
    const betType = curBet.betType;
    const line = curBet.line;
    console.log('=====Open Bet=====');
    console.log(action.description);
    for(var j = 0; j < results.length; j++){
      if(results[j].ID == id){
        var homeScore = parseInt(results[j].HomeScore);
        var awayScore = parseInt(results[j].AwayScore);
        var homeScoreFirstHalf = parseInt(results[j].HomeScoreFirstHalf);
        var awayScoreFirstHalf = parseInt(results[j].AwayScoreFirstHalf);
        if(results[j].FinalType == 'Finished' && homeScore != null && awayScore!= null){
          if(betType=='homeTeamML'){
            console.log('=====Home Team ML=====');
            console.log(action.subBets[i].homeTeam + ': ' + homeScore + ' ' + action.subBets[i].awayTeam + ': ' + awayScore);
            if(homeScore > awayScore){
              subBets[i].calcResult = 'win';
            } else if(homeScore < awayScore){
              subBets[i].calcResult = 'loss';
            } else if(homeScore == awayScore){
              subBets[i].calcResult = 'draw';
            }
          }
          if(betType=='homeTeamFirstHalfFB'){
            console.log('=====Home Team 1H=====');
            console.log(action.subBets[i].homeTeam + ': ' + homeScoreFirstHalf + ' ' + action.subBets[i].awayTeam + ': ' + awayScoreFirstHalf);
            if(homeScoreFirstHalf > awayScoreFirstHalf){
              subBets[i].calcResult = 'win';
            } else if(homeScoreFirstHalf < awayScoreFirstHalf){
              subBets[i].calcResult = 'loss';
            } else if(homeScoreFirstHalf == awayScoreFirstHalf){
              subBets[i].calcResult = 'draw';
            }
          }
          if(betType=='awayTeamML'){
            console.log('=====awayTeamML=====');
            console.log(action.subBets[i].homeTeam + ': ' + homeScore + ' ' + action.subBets[i].awayTeam + ': ' + awayScore);
            if(awayScore > homeScore){
              subBets[i].calcResult = 'win';
            } else if(awayScore < homeScore){
              subBets[i].calcResult = 'loss';
            } else if(homeScore == awayScore){
              subBets[i].calcResult = 'draw';
            }
          }
          if(betType=='awayTeamFirstHalfFB'){
            console.log('=====Away Team 1H=====');
            console.log(action.subBets[i].homeTeam + ': ' + homeScoreFirstHalf + ' ' + action.subBets[i].awayTeam + ': ' + awayScoreFirstHalf);
            if(awayScoreFirstHalf > homeScoreFirstHalf){
              subBets[i].calcResult = 'win';
            } else if(homeScoreFirstHalf > awayScoreFirstHalf){
              subBets[i].calcResult = 'loss';
            } else if(homeScoreFirstHalf == awayScoreFirstHalf){
              subBets[i].calcResult = 'draw';
            }
          }
          if(betType=='homeTeamRL'){
            console.log('=====Home Team RL=====');
            console.log(action.subBets[i].homeTeam + ': ' + homeScore + ' ' + action.subBets[i].awayTeam + ': ' + awayScore);
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
            console.log('=====Away Team RL=====');
            console.log(action.subBets[i].homeTeam + ': ' + homeScore + ' ' + action.subBets[i].awayTeam + ': ' + awayScore);
            if(awayScore > homeScore){
              subBets[i].calcResult = 'win';
            } else if(awayScore < homeScore){
              subBets[i].calcResult = 'loss';
            } else if(homeScore == awayScore){
              subBets[i].calcResult = 'draw';
            }
          }
          if(betType=='over'){
            console.log('=====OVER '+ subBets[i].totalNumber +'=====');
            console.log(action.subBets[i].homeTeam + ': ' + homeScore + ' ' + action.subBets[i].awayTeam + ': ' + awayScore);
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
            console.log('=====Under '+ subBets[i].totalNumber +'=====');
            console.log(action.subBets[i].homeTeam + ': ' + homeScore + ' ' + action.subBets[i].awayTeam + ': ' + awayScore);
            const totalNumber = subBets[i].totalNumber;
            if(homeScore + awayScore < totalNumber){
              subBets[i].calcResult = 'win';
            } else if(homeScore + awayScore > totalNumber){
              subBets[i].calcResult = 'loss';
            } else if(homeScore + awayScore == totalNumber){
              subBets[i].calcResult = 'draw';
            }
          }
          if(betType=='firstHalfOverFB'){
            console.log('=====1H Over FB '+ subBets[i].firstHalfOver +'=====');
            console.log(action.subBets[i].homeTeam + ': ' + homeScoreFirstHalf + ' ' + action.subBets[i].awayTeam + ': ' + awayScoreFirstHalf);
            const totalNumber = subBets[i].firstHalfOver;
            if(homeScoreFirstHalf + awayScoreFirstHalf > totalNumber){
              subBets[i].calcResult = 'win';
            } else if(homeScoreFirstHalf + awayScoreFirstHalf < totalNumber){
              subBets[i].calcResult = 'loss';
            } else if(homeScoreFirstHalf + awayScoreFirstHalf == totalNumber){
              subBets[i].calcResult = 'draw';
            }
          }
          if(betType=='firstHalfUnderFB'){
            console.log('=====1H Over FB '+ subBets[i].firstHalfUnder +'=====');
            console.log(action.subBets[i].homeTeam + ': ' + homeScoreFirstHalf + ' ' + action.subBets[i].awayTeam + ': ' + awayScoreFirstHalf);
            const totalNumber = subBets[i].firstHalfUnder;
            if(homeScoreFirstHalf + awayScoreFirstHalf < totalNumber){
              subBets[i].calcResult = 'win';
            } else if(homeScoreFirstHalf + awayScoreFirstHalf > totalNumber){
              subBets[i].calcResult = 'loss';
            } else if(homeScoreFirstHalf + awayScoreFirstHalf == totalNumber){
              subBets[i].calcResult = 'draw';
            }
          }
          if(betType=='awayTeamUnder'){
            console.log('=====Away Team Under '+ subBets[i].awayTeamTotalLine +'=====');
            console.log(action.subBets[i].awayTeam + ': ' + awayScore);
            const awayTotalNumber = parseFloat(subBets[i].awayTeamTotalLine);
            if(awayScore < awayTotalNumber){
              subBets[i].calcResult = 'win';
            } else if(awayScore > awayTotalNumber){
              subBets[i].calcResult = 'loss';
            } else if(awayScore == awayTotalNumber){
              subBets[i].calcResult = 'draw';
            }
          }
          if(betType=='homeTeamUnder'){
            console.log('=====Home Team Under '+ subBets[i].homeTeamTotalLine +'=====');
            console.log(action.subBets[i].homeTeam + ': ' + homeScore);
            const homeTotalNumber = parseFloat(subBets[i].homeTeamTotalLine);
            if(homeScore < homeTotalNumber){
              subBets[i].calcResult = 'win';
            } else if(homeScore > homeTotalNumber){
              subBets[i].calcResult = 'loss';
            } else if(homeScore == homeTotalNumber){
              subBets[i].calcResult = 'draw';
            }
          }
          if(betType=='awayTeamOver'){
            console.log('=====Away Team Over '+ subBets[i].awayTeamTotalLine +'=====');
            console.log(action.subBets[i].awayTeam + ': ' + awayScore);
            const awayTotalNumber = parseFloat(subBets[i].awayTeamTotalLine);
            if(awayScore > awayTotalNumber){
              subBets[i].calcResult = 'win';
            } else if(awayScore < awayTotalNumber){
              subBets[i].calcResult = 'loss';
            } else if(awayScore == awayTotalNumber){
              subBets[i].calcResult = 'draw';
            }
          }
          if(betType=='homeTeamOver'){
            console.log('=====Home Team Over '+ subBets[i].homeTeamTotalLine +'=====');
            console.log(action.subBets[i].homeTeam + ': ' + homeScore);
            const homeTotalNumber = parseFloat(subBets[i].homeTeamTotalLine);
            if(homeScore > homeTotalNumber){
              subBets[i].calcResult = 'win';
            } else if(homeScore < homeTotalNumber){
              subBets[i].calcResult = 'loss';
            } else if(homeScore == homeTotalNumber){
              subBets[i].calcResult = 'draw';
            }
          }
        }
      }
    }
  }
  if(allBetsSatisfied(action)){
    const res = calcBetResult(action);
    console.log('Result: ' + res)
    if(res=='win' || res=='loss'){
      closeBet(action, res);
    }
  }
}

//Close all JSON Bets
getAllUserBalances(function(success){
  if(success==true){
    getAllJsonResults(function(results){
      if(results != false){
        getAllOpenBets('jsonOdds', function(jsonOdds){
          for(var i = 0; i < jsonOdds.length; i++){
            getBetResults(jsonOdds[i], results);
          }
          bet365();
        });
      }
    });
  }
});

var bet365 = function(){
  getAllOpenBets('bet365', function(bet365Odds){
    getAllBet365Results(createBet365String(bet365Odds), function(results){
      for(var i = 0; i < bet365Odds.length; i++){
        getBetResults(bet365Odds[i], results);
      }
    });
  });
}
