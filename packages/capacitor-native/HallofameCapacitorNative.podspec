require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'HallofameCapacitorNative'
  s.version = package['version']
  s.summary = package['description']
  s.license = 'UNLICENSED'
  s.homepage = 'https://github.com/halloffame-hq/halloffame.plugins'
  s.author = 'Hall Of Fame'
  s.source = { :git => 'https://github.com/halloffame-hq/halloffame.plugins.git', :tag => package['version'] }
  s.source_files = 'ios/Sources/**/*.swift'
  s.ios.deployment_target = '15.0'
  s.frameworks = 'Photos', 'PhotosUI', 'UniformTypeIdentifiers'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
end
