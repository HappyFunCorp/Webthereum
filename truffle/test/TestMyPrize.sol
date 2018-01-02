pragma solidity ^0.4.18;

import "truffle/Assert.sol";
import "../contracts/MyPrize.sol";

contract TestMyPrize {
  MyPrize mp = new MyPrize();

  function testMyPrize() public {
    mp.placePrize(1, bytes10("abcdefghij"), "http://test.example.com/");
    var (id, owner, geohash, metadata, placedAt) = mp.prizes(uint(1));
    Assert.equal (bytes10("abcdefghij"), geohash, "Geohash was successfully set");
    Assert.equal (address(0), owner, "Ownership was successfully abdicated");
    Assert.equal (block.number, placedAt, "PlacedAt successfully set");

    // mp.claimPrize(1, bytes10("abcdefghij"));
    // var (id2, owner2, geohash2, metadata2, placedAt2) = mp.prizes(uint(1));
    // Assert.equal (bytes10(""), geohash2, "Geohash was successfully cleared");
    // Assert.equal (msg.sender, owner2, "Ownership was successfully claimed");
  }
}
